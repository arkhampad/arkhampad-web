// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PadHub} from "./PadHub.sol";
import {FeeMode} from "./PadTypes.sol";
import {PadPromote} from "./PadPromote.sol";
import {PadPoolBuilder} from "./PadPoolBuilder.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title PadRouter
/// @notice Gasless trading. A user signs what they want (buy, sell, launch,
/// withdraw, promote); anyone (normally the ArkhamPad relayer) submits it and
/// pays the network gas. The user pays that gas back in USDC: the `fee` they
/// signed is sent to the submitter. Users never need ETH.
///
/// Safety:
///  - Every request is signed by the user (EIP-712) and names the exact amounts,
///    the fee, a deadline and a one-time nonce. Nothing else can be done with a user's funds.
///  - Prices are protected on-chain by minimum-out amounts the user signed, so a
///    delayed order (limit / take profit / stop loss) can never fill worse than signed.
///  - The router holds no money between calls; leftovers are returned in the same call.
contract PadRouter is EIP712, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;

    bytes32 public constant CREATE_TYPEHASH = keccak256(
        "Create(address user,string name,string symbol,string metadataURI,uint256 lockSeconds,uint8 feeMode,uint256 launchUsdc,uint256 minCoinsOut,uint256 fee,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant WITHDRAW_TYPEHASH =
        keccak256("Withdraw(address user,address to,uint256 amount,uint256 fee,uint256 nonce,uint256 deadline)");
    bytes32 public constant PROMOTE_TYPEHASH = keccak256(
        "Promote(address user,address coin,uint256 coinChainId,uint8 plan,uint256 maxPrice,uint256 fee,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(address user,uint256 nonce)");
    bytes32 public constant POOL_BUY_TYPEHASH =
        keccak256("PoolBuy(address user,address coin,uint256 usdcIn,uint256 minCoinsOut,uint256 fee,uint256 nonce,uint256 deadline)");
    bytes32 public constant POOL_SELL_TYPEHASH =
        keccak256("PoolSell(address user,address coin,uint256 coinAmount,uint256 minUsdcOut,uint256 fee,uint256 nonce,uint256 deadline)");

    PadHub public immutable hub;
    IERC20 public immutable usdc;
    PadPromote public immutable promoter;
    /// @notice Opens and holds every coin's locked pool (zero: pool trading off).
    PadPoolBuilder public immutable builder;
    IPoolManager public immutable poolManager;
    /// @dev Set only while this router itself is inside PoolManager.unlock, so nobody else can
    /// make the PoolManager call our callback.
    bool private _unlocking;

    /// @notice user => nonce => used (any order of use, so many open orders can coexist)
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    event Launched(address indexed user, address indexed coin, uint256 launchUsdc, uint256 fee, uint256 nonce);
    event Withdrawn(address indexed user, address indexed to, uint256 amount, uint256 fee, uint256 nonce);
    event Promoted(address indexed user, address indexed coin, uint8 plan, uint256 fee, uint256 nonce);
    event NonceCancelled(address indexed user, uint256 nonce);
    event Swept(address indexed token, address indexed to, uint256 amount);
    event PoolTraded(address indexed user, address indexed coin, bool isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 fee, uint256 nonce);

    error Expired();
    error NonceAlreadyUsed();
    error BadSignature();
    error FeeTooHigh();
    error Slippage(uint256 got, uint256 minimum);
    error ZeroAddress();
    error NoPool();
    error OnlyPoolManager();
    error Quote(uint256 amountOut);
    error NotUnlocking();
    error NotAdmin();

    struct Sig {
        uint256 deadline;
        uint256 nonce;
        bytes signature;
    }

    constructor(PadHub hub_, PadPromote promoter_, PadPoolBuilder builder_) EIP712("ArkhamPad", "1") {
        if (address(hub_) == address(0)) revert ZeroAddress();
        hub = hub_;
        usdc = hub_.usdc();
        promoter = promoter_;
        builder = builder_;
        poolManager = address(builder_) == address(0) ? IPoolManager(address(0)) : builder_.poolManager();
    }

    // ---------------------------------------------------------------- approvals by signature

    /// @notice Submits an EIP-2612 permit (USDC or a coin) for the router.
    /// Never reverts on failure: a permit can be front-run, and the allowance
    /// it sets may already be in place.
    function permit(address token, address owner, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        try IERC20Permit(token).permit(owner, address(this), value, deadline, v, r, s) {} catch {}
    }

    // ---------------------------------------------------------------- trading

    struct Launch {
        string name;
        string symbol;
        string metadataURI;
        uint256 lockSeconds;
        FeeMode feeMode;
        uint256 launchUsdc;
        uint256 minCoinsOut;
    }

    function launch(address user, Launch calldata l, uint256 fee, Sig calldata sig)
        external
        nonReentrant
        returns (address coin)
    {
        bytes32 h = _launchHash(user, l, fee, sig);
        _use(user, sig, h);

        if (l.launchUsdc + fee > 0) usdc.safeTransferFrom(user, address(this), l.launchUsdc + fee);
        if (fee > 0) usdc.safeTransfer(msg.sender, fee);

        uint256 spent;
        (coin, spent) = _createFor(user, l);
        emit Launched(user, coin, spent, fee, sig.nonce);
    }

    // ---------------------------------------------------------------- trading (each coin's locked Uniswap v4 pool)

    /// @notice Buys a coin in its locked pool with USDC: signed by the user,
    /// network fee paid back in USDC, never fills below minCoinsOut.
    function poolBuy(address user, address coin, uint256 usdcIn, uint256 minCoinsOut, uint256 fee, Sig calldata sig)
        external
        nonReentrant
        returns (uint256 coinsOut)
    {
        _use(user, sig, keccak256(abi.encode(POOL_BUY_TYPEHASH, user, coin, usdcIn, minCoinsOut, fee, sig.nonce, sig.deadline)));
        _requirePool(coin);
        usdc.safeTransferFrom(user, address(this), usdcIn + fee);
        if (fee > 0) usdc.safeTransfer(msg.sender, fee);
        uint256 paid;
        (coinsOut, paid) = _poolSwap(coin, true, usdcIn);
        if (coinsOut < minCoinsOut) revert Slippage(coinsOut, minCoinsOut);
        if (paid < usdcIn) usdc.safeTransfer(user, usdcIn - paid); // only part could be swapped
        IERC20(coin).safeTransfer(user, coinsOut);
        emit PoolTraded(user, coin, true, usdcIn, coinsOut, fee, sig.nonce);
    }

    /// @notice Sells a coin in its locked pool for USDC (fee taken from the USDC out).
    function poolSell(address user, address coin, uint256 coinAmount, uint256 minUsdcOut, uint256 fee, Sig calldata sig)
        external
        nonReentrant
        returns (uint256 usdcToUser)
    {
        _use(user, sig, keccak256(abi.encode(POOL_SELL_TYPEHASH, user, coin, coinAmount, minUsdcOut, fee, sig.nonce, sig.deadline)));
        _requirePool(coin);
        IERC20(coin).safeTransferFrom(user, address(this), coinAmount);
        (uint256 out, uint256 paid) = _poolSwap(coin, false, coinAmount);
        if (paid < coinAmount) IERC20(coin).safeTransfer(user, coinAmount - paid);
        if (out < fee) revert FeeTooHigh();
        usdcToUser = out - fee;
        if (usdcToUser < minUsdcOut) revert Slippage(usdcToUser, minUsdcOut);
        if (fee > 0) usdc.safeTransfer(msg.sender, fee);
        usdc.safeTransfer(user, usdcToUser);
        emit PoolTraded(user, coin, false, out, coinAmount, fee, sig.nonce);
    }

    /// @notice What a pool trade would return right now. Not a view: call it with eth_call.
    /// The swap is simulated inside the pool and undone (it always reverts internally).
    function quotePool(address coin, bool isBuy, uint256 amountIn) external returns (uint256 amountOut) {
        _requirePool(coin);
        _unlocking = true;
        try poolManager.unlock(abi.encode(coin, isBuy, amountIn, true)) {
            _unlocking = false;
            return 0; // unreachable: a quote always reverts with the result
        } catch (bytes memory err) {
            _unlocking = false;
            if (err.length == 36 && bytes4(err) == Quote.selector) {
                assembly { amountOut := mload(add(err, 36)) }
                return amountOut;
            }
            assembly { revert(add(err, 32), mload(err)) }
        }
    }

    /// @notice Returns tokens someone sent to the router by mistake. The router holds nothing
    /// between transactions, so this can never touch a user's trade. Hub admin only.
    function sweep(address token, address to) external nonReentrant {
        if (msg.sender != hub.admin()) revert NotAdmin();
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(to, bal);
        emit Swept(token, to, bal);
    }

    function _requirePool(address coin) private view {
        if (address(poolManager) == address(0) || !hub.isCoin(coin)) revert NoPool();
        (uint256 positionId,,) = builder.pools(coin);
        if (positionId == 0) revert NoPool();
    }

    function _poolSwap(address coin, bool usdcIn, uint256 amountIn) private returns (uint256 out, uint256 paid) {
        _unlocking = true;
        (out, paid) = abi.decode(poolManager.unlock(abi.encode(coin, usdcIn, amountIn, false)), (uint256, uint256));
        _unlocking = false;
    }

    /// @dev Exact-input swap; the router pays in and receives the output itself.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        if (!_unlocking) revert NotUnlocking();
        (address coin, bool usdcIn, uint256 amountIn, bool quote) = abi.decode(data, (address, bool, uint256, bool));
        PoolKey memory key = builder.poolKeyFor(coin);
        bool usdcIs0 = Currency.unwrap(key.currency0) == address(usdc);
        bool zeroForOne = usdcIn ? usdcIs0 : !usdcIs0;
        BalanceDelta d = poolManager.swap(
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}),
            ""
        );
        int128 inD = zeroForOne ? d.amount0() : d.amount1();
        int128 outD = zeroForOne ? d.amount1() : d.amount0();
        uint256 pay = uint256(uint128(-inD));
        uint256 out = uint256(uint128(outD));
        if (quote) revert Quote(out);
        (Currency inC, Currency outC) = zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        poolManager.sync(inC);
        IERC20(Currency.unwrap(inC)).safeTransfer(address(poolManager), pay);
        poolManager.settle();
        poolManager.take(outC, address(this), out);
        return abi.encode(out, pay);
    }

    // ---------------------------------------------------------------- money out, promote, cancel

    function withdraw(address user, address to, uint256 amount, uint256 fee, Sig calldata sig) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _use(user, sig, keccak256(abi.encode(WITHDRAW_TYPEHASH, user, to, amount, fee, sig.nonce, sig.deadline)));
        usdc.safeTransferFrom(user, to, amount);
        if (fee > 0) usdc.safeTransferFrom(user, msg.sender, fee);
        emit Withdrawn(user, to, amount, fee, sig.nonce);
    }

    function promote(address user, address coin, uint256 coinChainId, uint8 plan, uint256 maxPrice, uint256 fee, Sig calldata sig)
        external
        nonReentrant
    {
        _use(user, sig, keccak256(abi.encode(PROMOTE_TYPEHASH, user, coin, coinChainId, plan, maxPrice, fee, sig.nonce, sig.deadline)));
        (, uint128 price,) = promoter.plans(plan);
        if (price > maxPrice) revert Slippage(maxPrice, price);
        usdc.safeTransferFrom(user, address(this), uint256(price) + fee);
        if (fee > 0) usdc.safeTransfer(msg.sender, fee);
        usdc.forceApprove(address(promoter), price);
        promoter.promote(coin, coinChainId, plan);
        usdc.forceApprove(address(promoter), 0);
        emit Promoted(user, coin, plan, fee, sig.nonce);
    }

    /// @notice Cancels an open (signed but unsent) order. The user can call it
    /// directly, or sign a Cancel and let anyone submit it.
    function cancel(address user, uint256 nonce, bytes calldata signature) external {
        if (msg.sender != user) {
            bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, user, nonce)));
            if (!SignatureChecker.isValidSignatureNow(user, digest, signature)) revert BadSignature();
        }
        if (nonceUsed[user][nonce]) revert NonceAlreadyUsed();
        nonceUsed[user][nonce] = true;
        emit NonceCancelled(user, nonce);
    }

    // ---------------------------------------------------------------- views / internal

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @dev Creates the coin through the hub, paying the launch buy; returns any unspent USDC to the user.
    function _createFor(address user, Launch calldata l) private returns (address coin, uint256 spent) {
        uint256 before = usdc.balanceOf(address(this));
        if (l.launchUsdc > 0) usdc.forceApprove(address(hub), l.launchUsdc);
        coin = hub.createCoinFor(user, l.name, l.symbol, l.metadataURI, l.lockSeconds, l.feeMode, l.launchUsdc, l.minCoinsOut);
        if (l.launchUsdc > 0) usdc.forceApprove(address(hub), 0);
        spent = before - usdc.balanceOf(address(this));
        if (spent < l.launchUsdc) usdc.safeTransfer(user, l.launchUsdc - spent);
    }

    /// @dev EIP-712 struct hash of a Create request. abi.encode of fixed-size
    /// values is plain concatenation, so it is built in two halves (fewer
    /// values on the stack at once); the result is identical.
    function _launchHash(address user, Launch calldata l, uint256 fee, Sig calldata sig) private pure returns (bytes32) {
        bytes memory head = _launchHead(user, l);
        bytes memory tail = abi.encode(l.lockSeconds, uint8(l.feeMode), l.launchUsdc, l.minCoinsOut, fee, sig.nonce, sig.deadline);
        return keccak256(bytes.concat(head, tail));
    }

    function _launchHead(address user, Launch calldata l) private pure returns (bytes memory) {
        bytes32 n = keccak256(bytes(l.name));
        bytes32 sy = keccak256(bytes(l.symbol));
        bytes32 u = keccak256(bytes(l.metadataURI));
        return abi.encode(CREATE_TYPEHASH, user, n, sy, u);
    }

    function _use(address user, Sig calldata sig, bytes32 structHash) private {
        if (block.timestamp > sig.deadline) revert Expired();
        if (nonceUsed[user][sig.nonce]) revert NonceAlreadyUsed();
        if (!SignatureChecker.isValidSignatureNow(user, _hashTypedDataV4(structHash), sig.signature)) revert BadSignature();
        nonceUsed[user][sig.nonce] = true;
    }
}
