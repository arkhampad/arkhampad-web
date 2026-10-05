// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {IPadHub, IPadPoolBuilder} from "./interfaces.sol";
import {PadCurve} from "./PadCurve.sol";
import {PadInitGuard} from "./PadInitGuard.sol";

/// @title PadPoolBuilder
/// @notice Turns a graduated ArkhamPad curve into a Uniswap v4 coin/USDC pool
/// (1% fee) with full-range liquidity that is locked forever: the position
/// NFT stays in this contract, which has no way to remove liquidity or move it.
///
/// Pool trading fees can be collected by anyone with `collectFees(coin)`.
/// They are split 70% to the platform treasury and 30% to the coin:
///   - fee mode ToCreator:   paid to the coin's creator,
///   - fee mode BuybackBurn: USDC is kept to buy the coin back and burn it,
///                           coin fees are burned straight away.
/// Fees in both currencies are split the same way.
contract PadPoolBuilder is IPadPoolBuilder, IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint24 public constant POOL_FEE = 10_000; // 1%
    int24 public constant TICK_SPACING = 200;
    uint256 public constant BPS = 10_000;
    uint256 public constant COIN_CUT_BPS = 3_000; // 30% of pool fees to the coin side
    /// @notice Most USDC one buyback call spends in the pool.
    /// @notice Most USDC one buyback call spends ($100, in the dollar token's own decimals).
    uint256 public immutable MAX_BUYBACK_STEP;
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    IERC20 public immutable usdc;
    PadInitGuard public immutable guard;
    address private immutable _deployer;

    IPadHub public hub;

    struct Pool {
        uint256 positionId;
        address creator;
        PadCurve.FeeMode feeMode;
    }

    mapping(address coin => Pool) public pools;
    /// @notice USDC waiting to buy back and burn a coin.
    mapping(address coin => uint256) public buybackFunds;
    /// @notice USDC a recipient could not receive when it was sent; claim with `claimOwed`.
    mapping(address who => uint256) public owed;
    /// @dev USDC held for others (buyback funds + owed + dust); never part of a new pool.
    uint256 public usdcHeld;

    event PoolBuilt(address indexed coin, uint256 indexed positionId, uint256 usdcIn, uint256 coinsIn, uint160 sqrtPriceX96);
    event FeesCollected(address indexed coin, uint256 usdcFees, uint256 coinFees);
    event BuybackFunded(address indexed coin, uint256 amount);
    event BuybackDone(address indexed coin, uint256 usdcSpent, uint256 coinsBurned);
    event Owed(address indexed who, uint256 amount);

    error ZeroAddress();
    error NotDeployer();
    error AlreadyBound();
    error NotACurve();
    error AlreadyBuilt();
    error NotBuilt();
    error NothingToDo();
    error NotDelivered();
    error BadGuardAddress(address guard);
    error NotPoolManager();

    constructor(
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        IAllowanceTransfer permit2_,
        IERC20 usdc_,
        bytes32 guardSalt
    ) {
        if (
            address(poolManager_) == address(0) || address(positionManager_) == address(0) || address(permit2_) == address(0)
                || address(usdc_) == address(0)
        ) revert ZeroAddress();
        poolManager = poolManager_;
        positionManager = positionManager_;
        MAX_BUYBACK_STEP = 100 * 10 ** IERC20Metadata(address(usdc_)).decimals();
        permit2 = permit2_;
        usdc = usdc_;
        _deployer = msg.sender;
        guard = new PadInitGuard{salt: guardSalt}(address(poolManager_), address(this));
        if (uint160(address(guard)) & Hooks.ALL_HOOK_MASK != Hooks.BEFORE_INITIALIZE_FLAG) {
            revert BadGuardAddress(address(guard));
        }
    }

    /// @notice Links the hub once, right after deployment (the hub needs this
    /// contract's address first, so they cannot be set in one constructor).
    function bindHub(IPadHub hub_) external {
        if (msg.sender != _deployer) revert NotDeployer();
        if (address(hub) != address(0)) revert AlreadyBound();
        if (address(hub_) == address(0)) revert ZeroAddress();
        hub = hub_;
    }

    // ---------------------------------------------------------------- pool

    function usdcIsCurrency0(address coin) public view returns (bool) {
        return address(usdc) < coin;
    }

    function poolKeyFor(address coin) public view returns (PoolKey memory) {
        bool u0 = usdcIsCurrency0(coin);
        return PoolKey({
            currency0: Currency.wrap(u0 ? address(usdc) : coin),
            currency1: Currency.wrap(u0 ? coin : address(usdc)),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(guard))
        });
    }

    /// @inheritdoc IPadPoolBuilder
    /// @dev Called by a graduating curve after it has sent the coins and USDC here.
    function buildPool(address coin, uint256 coinAmount, uint256 usdcAmount) external nonReentrant {
        if (address(hub) == address(0) || !hub.isCurve(msg.sender)) revert NotACurve();
        if (address(PadCurve(msg.sender).coin()) != coin) revert NotACurve();
        if (pools[coin].positionId != 0) revert AlreadyBuilt();
        if (coinAmount == 0 || usdcAmount == 0) revert NothingToDo();
        if (usdc.balanceOf(address(this)) < usdcHeld + usdcAmount) revert NotDelivered();
        if (IERC20(coin).balanceOf(address(this)) < coinAmount) revert NotDelivered();

        PoolKey memory key = poolKeyFor(coin);
        bool u0 = usdcIsCurrency0(coin);
        uint256 amount0 = u0 ? usdcAmount : coinAmount;
        uint256 amount1 = u0 ? coinAmount : usdcAmount;

        uint160 sqrtPriceX96 = _sqrtPriceX96(amount0, amount1);
        poolManager.initialize(key, sqrtPriceX96);

        int24 lower = TickMath.minUsableTick(TICK_SPACING);
        int24 upper = TickMath.maxUsableTick(TICK_SPACING);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), amount0, amount1
        );
        if (liquidity == 0) revert NothingToDo();

        _approve(coin, coinAmount);
        _approve(address(usdc), usdcAmount);

        uint256 usdcBefore = usdc.balanceOf(address(this));
        uint256 coinBefore = IERC20(coin).balanceOf(address(this));
        uint256 positionId = positionManager.nextTokenId();

        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, uint256(liquidity), amount0, amount1, address(this), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        _approve(coin, 0);
        _approve(address(usdc), 0);

        // Rounding dust: coins are burned, USDC stays locked here as dust.
        uint256 usdcUsed = usdcBefore - usdc.balanceOf(address(this));
        uint256 coinUsed = coinBefore - IERC20(coin).balanceOf(address(this));
        if (coinAmount > coinUsed) IERC20(coin).safeTransfer(BURN, coinAmount - coinUsed);
        if (usdcAmount > usdcUsed) usdcHeld += usdcAmount - usdcUsed;

        PadCurve curve = PadCurve(msg.sender);
        pools[coin] = Pool({positionId: positionId, creator: curve.creator(), feeMode: curve.feeMode()});
        emit PoolBuilt(coin, positionId, usdcUsed, coinUsed, sqrtPriceX96);
    }

    // ---------------------------------------------------------------- fees

    /// @notice Collects a graduated coin's pool fees and splits them. Anyone can call.
    function collectFees(address coin) external nonReentrant returns (uint256 usdcFees, uint256 coinFees) {
        Pool memory p = pools[coin];
        if (p.positionId == 0) revert NotBuilt();
        PoolKey memory key = poolKeyFor(coin);

        uint256 usdcBefore = usdc.balanceOf(address(this));
        uint256 coinBefore = IERC20(coin).balanceOf(address(this));

        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(p.positionId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, address(this));
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        usdcFees = usdc.balanceOf(address(this)) - usdcBefore;
        coinFees = IERC20(coin).balanceOf(address(this)) - coinBefore;
        emit FeesCollected(coin, usdcFees, coinFees);

        address treasury = hub.treasury();
        if (usdcFees > 0) {
            uint256 toCoin = (usdcFees * COIN_CUT_BPS) / BPS;
            _payUsdc(treasury, usdcFees - toCoin);
            if (p.feeMode == PadCurve.FeeMode.BuybackBurn) {
                buybackFunds[coin] += toCoin;
                usdcHeld += toCoin;
                emit BuybackFunded(coin, toCoin);
            } else {
                _payUsdc(p.creator, toCoin);
            }
        }
        if (coinFees > 0) {
            uint256 toCoin = (coinFees * COIN_CUT_BPS) / BPS;
            IERC20(coin).safeTransfer(treasury, coinFees - toCoin);
            if (p.feeMode == PadCurve.FeeMode.BuybackBurn) {
                IERC20(coin).safeTransfer(BURN, toCoin);
            } else {
                _payCoin(coin, p.creator, toCoin);
            }
        }
    }

    /// @inheritdoc IPadPoolBuilder
    function fundBuyback(address coin, uint256 usdcAmount) external nonReentrant {
        if (address(hub) == address(0) || hub.curveOf(coin) != msg.sender) revert NotACurve();
        if (usdcAmount == 0) return;
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        buybackFunds[coin] += usdcAmount;
        usdcHeld += usdcAmount;
        emit BuybackFunded(coin, usdcAmount);
    }

    /// @notice Spends up to MAX_BUYBACK_STEP of a coin's buyback money in its
    /// pool and burns the coins bought. Anyone can call.
    function buyback(address coin) external nonReentrant returns (uint256 spent, uint256 burned) {
        if (pools[coin].positionId == 0) revert NotBuilt();
        spent = Math.min(buybackFunds[coin], MAX_BUYBACK_STEP);
        if (spent == 0) revert NothingToDo();
        buybackFunds[coin] -= spent;
        usdcHeld -= spent;
        burned = abi.decode(poolManager.unlock(abi.encode(coin, spent)), (uint256));
        emit BuybackDone(coin, spent, burned);
    }

    /// @dev Swap USDC -> coin inside the pool manager's lock; coins go to the burn address.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address coin, uint256 amountIn) = abi.decode(data, (address, uint256));
        PoolKey memory key = poolKeyFor(coin);
        bool zeroForOne = usdcIsCurrency0(coin);
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            bytes("")
        );
        int128 usdcDelta = zeroForOne ? delta.amount0() : delta.amount1();
        int128 coinDelta = zeroForOne ? delta.amount1() : delta.amount0();
        uint256 pay = uint256(uint128(-usdcDelta));
        uint256 out = uint256(uint128(coinDelta));

        Currency u = Currency.wrap(address(usdc));
        poolManager.sync(u);
        usdc.safeTransfer(address(poolManager), pay);
        poolManager.settle();
        poolManager.take(Currency.wrap(coin), BURN, out);
        // An exact-input swap can stop at the price limit with input left over.
        if (pay < amountIn) {
            buybackFunds[coin] += amountIn - pay;
            usdcHeld += amountIn - pay;
        }
        return abi.encode(out);
    }

    /// @notice Pays out USDC that could not be sent earlier.
    function claimOwed() external nonReentrant {
        uint256 a = owed[msg.sender];
        if (a == 0) revert NothingToDo();
        owed[msg.sender] = 0;
        usdcHeld -= a;
        usdc.safeTransfer(msg.sender, a);
    }

    // ---------------------------------------------------------------- helpers

    function _payUsdc(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory ret) = address(usdc).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) {
            owed[to] += amount;
            usdcHeld += amount;
            emit Owed(to, amount);
        }
    }

    function _payCoin(address coin, address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory ret) = coin.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        // A creator who can't receive (e.g. still locked is fine; receiving is never locked) - burn instead.
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) IERC20(coin).safeTransfer(BURN, amount);
    }

    function _approve(address token, uint256 amount) private {
        if (amount > 0) IERC20(token).forceApprove(address(permit2), type(uint256).max);
        else IERC20(token).forceApprove(address(permit2), 0);
        permit2.approve(token, address(positionManager), uint160(amount), uint48(block.timestamp));
    }

    /// @dev sqrt(amount1 / amount0) in Q64.96, i.e. price of currency0 in currency1.
    function _sqrtPriceX96(uint256 amount0, uint256 amount1) private pure returns (uint160) {
        uint256 s;
        if (amount1 / amount0 < (1 << 63)) {
            // sqrt(amount1 * 2^192 / amount0): the ratio fits, full precision.
            s = Math.sqrt(Math.mulDiv(amount1, 1 << 192, amount0));
        } else {
            // Very large ratio: sqrt(amount1 * 2^96 / amount0) * 2^48 avoids overflow.
            s = Math.sqrt(Math.mulDiv(amount1, 1 << 96, amount0)) << 48;
        }
        if (s < TickMath.MIN_SQRT_PRICE) s = TickMath.MIN_SQRT_PRICE;
        if (s >= TickMath.MAX_SQRT_PRICE) s = TickMath.MAX_SQRT_PRICE - 1;
        return uint160(s);
    }
}
