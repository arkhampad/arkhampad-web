// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "./TickMath.sol";
import {ArkhamPadCoin} from "./ArkhamPadCoin.sol";
import {IV3PositionManager, IV3Pool, IWrappedNative} from "./ArkhamV3Launcher.sol";

interface IV3PoolSlot0 {
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
}

/**
 * ArkhamPad launcher, version 2: the same launch as version 1 (fixed supply, all of it in a coin/WHYPE pool,
 * liquidity locked here forever, the creator's first buy straight against the pool), with a creator fee
 * share that grows with the coin. Coins launched by version 1 are not affected; they keep their 30%.
 *
 * Every trade pays the pool's 1% fee. It is split at collection:
 *
 *   below the first market-cap level (about $25K, fixed per coin at launch, in HYPE):
 *     - during the coin's first 24 hours: creator 20%, ArkhamPad 65%, 15% held for the creator
 *     - after that:                       creator 20%, ArkhamPad 80%
 *   at or above the first level for 1 hour without a break:   creator 50%, ArkhamPad 50%
 *   at or above the second level (about $100K) once there:   creator 60%, ArkhamPad 40%
 *
 *   The held 15% goes to the creator the moment the coin qualifies (if its hour above the first level
 *   started within the first 24 hours); otherwise it goes to ArkhamPad once that can no longer happen.
 *   A coin that falls back below the first level is back at 20% / 80% and needs a new full hour above it.
 *
 * Market cap = the pool's current price x the whole supply. The level is only changed by poke(), which
 * only ArkhamPad's keeper (or the owner) can call, every few minutes (at random intervals) for active coins.
 * "An hour above the line" means: at least an hour since the first check that saw it above, AND at least
 * MIN_CHECKS checks in a row that all saw it above (L2_CHECKS in a row for the second level). One dip seen
 * by any check starts it over. poke() reads the market cap before anything else happens in it, and native
 * payouts get a small fixed amount of gas, so nothing a creator's contract does when paid can move what a
 * check sees. Fees always go out at the level that was in force since the previous poke.
 *
 * The split numbers below are constants: the rules can't change for a coin after it launched.
 * Read functions and events of version 1 are kept as they are (coins(), Launched, FeesCollected), so
 * everything that reads version 1 reads this one the same way.
 */
contract ArkhamV3LauncherV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant SUPPLY = 1_000_000_000 ether;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ------------------------------------------------ the fee rules (basis points of each collected fee)
    uint16 public constant BASE_CREATOR_BPS = 2_000; // below the first level
    uint16 public constant HELD_BPS = 1_500; // held for the creator during the first 24 hours, below the first level
    uint16 public constant LEVEL1_CREATOR_BPS = 5_000; // at/above the first level, after a full hour
    uint16 public constant LEVEL2_CREATOR_BPS = 6_000; // at/above the second level
    uint32 public constant WINDOW = 24 hours; // the held share builds up only in a coin's first 24 hours
    uint32 public constant HOLD = 1 hours; // time above the first level before the higher share starts
    uint16 public constant MIN_CHECKS = 6; // ...and this many checks in a row above it in that time
    uint16 public constant L2_CHECKS = 3; // checks in a row at/above the second level before 60%
    uint256 private constant SEND_GAS = 50_000; // gas given to a native payout (a wallet or multisig needs far less)

    IV3PositionManager public immutable positions;
    IWrappedNative public immutable wrapped;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;

    /// Gets ArkhamPad's share of pool fees and the launch fee.
    address public treasury;
    /// Starting market cap of a new coin, in native wei (HYPE), for the whole supply.
    uint256 public startMc;
    /// Paid by the launcher, in native wei, on top of the first buy.
    uint256 public launchFee;
    bool public paused;
    /// Market-cap levels for coins launched from now on, in native wei for the whole supply (about $25K and
    /// $100K in HYPE at the time of launch). Each coin keeps the levels it launched with.
    uint256 public level1Mc;
    uint256 public level2Mc;
    /// The only account besides the owner that may move coins between levels.
    address public keeper;

    /// Same layout as version 1 (creatorBps = the starting share, 20%), so version-1 readers work unchanged.
    struct Coin {
        uint256 tokenId;
        address pool;
        address creator;
        uint16 creatorBps;
        bool coinIsToken0;
    }

    struct State {
        uint128 level1Mc; // this coin's levels (fixed at launch)
        uint128 level2Mc;
        uint40 launchedAt;
        uint40 aboveSince; // when the coin was first seen at/above level 1 in its current run (0 = below)
        uint8 level; // 0 below, 1 = level 1 reached (after the hour), 2 = level 2
        bool heldSettled; // the held share has gone to the creator or to ArkhamPad
        uint256 heldNative; // held for the creator, in native wei
        uint256 heldCoin; // held for the creator, in the coin
    }

    mapping(address coin => Coin) public coins;
    mapping(address coin => State) public states;
    /// Checks in a row that saw the coin at/above level 1 (above1) and at/above level 2 (above2).
    struct Checks {
        uint16 above1;
        uint16 above2;
    }

    mapping(address coin => Checks) public checks;
    address[] public allCoins;
    /// Native wei sitting in this contract for creators (held shares); never ArkhamPad's to take early.
    uint256 public heldNativeTotal;

    address private swapping; // the pool whose swap callback is expected

    event Launched(
        address indexed coin,
        address indexed creator,
        address pool,
        uint256 tokenId,
        string name,
        string symbol,
        string uri,
        uint256 startMc,
        uint256 firstBuyIn,
        uint256 firstBuyOut
    );
    event FeesCollected(address indexed coin, uint256 coinToCreator, uint256 coinToTreasury, uint256 nativeToCreator, uint256 nativeToTreasury);
    event FeesHeld(address indexed coin, uint256 coinHeld, uint256 nativeHeld);
    event LevelChanged(address indexed coin, uint8 level, uint256 marketCap);
    event HeldReleased(address indexed coin, address indexed creator, uint256 coinAmount, uint256 nativeAmount);
    event HeldToTreasury(address indexed coin, uint256 coinAmount, uint256 nativeAmount);
    event SettingsChanged(address treasury, uint256 startMc, uint256 launchFee, bool paused, uint256 level1Mc, uint256 level2Mc);
    event KeeperChanged(address keeper);

    error Paused();
    error BadSettings();
    error FeeNotPaid();
    error TooLittleOut();
    error UnknownCoin();
    error BadCallback();
    error EmptyName();
    error NotKeeper();
    error PoolTaken();
    error BadCreator();

    constructor(
        address owner_,
        IV3PositionManager positions_,
        IWrappedNative wrapped_,
        uint24 fee_,
        int24 tickSpacing_,
        address treasury_,
        uint256 startMc_,
        uint256 level1Mc_,
        uint256 level2Mc_,
        address keeper_
    ) Ownable(owner_) {
        if (address(positions_) == address(0) || address(wrapped_) == address(0) || tickSpacing_ <= 0) revert BadSettings();
        positions = positions_;
        wrapped = wrapped_;
        fee = fee_;
        tickSpacing = tickSpacing_;
        _set(treasury_, startMc_, 0, false, level1Mc_, level2Mc_);
        keeper = keeper_;
        emit KeeperChanged(keeper_);
    }

    // ---------------------------------------------------------------- settings (future coins only)

    function setSettings(address treasury_, uint256 startMc_, uint256 launchFee_, bool paused_, uint256 level1Mc_, uint256 level2Mc_)
        external
        onlyOwner
    {
        _set(treasury_, startMc_, launchFee_, paused_, level1Mc_, level2Mc_);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperChanged(keeper_);
    }

    function _set(address treasury_, uint256 startMc_, uint256 launchFee_, bool paused_, uint256 level1Mc_, uint256 level2Mc_) private {
        // the price math holds for market caps between 1e9 wei and 1e30 wei of the whole supply; the levels
        // sit above the start and in order
        if (
            treasury_ == address(0) || startMc_ < 1e9 || startMc_ > 1e30 || level1Mc_ <= startMc_ || level2Mc_ <= level1Mc_
                || level2Mc_ > 1e30
        ) revert BadSettings();
        treasury = treasury_;
        startMc = startMc_;
        launchFee = launchFee_;
        paused = paused_;
        level1Mc = level1Mc_;
        level2Mc = level2Mc_;
        emit SettingsChanged(treasury_, startMc_, launchFee_, paused_, level1Mc_, level2Mc_);
    }

    function coinCount() external view returns (uint256) {
        return allCoins.length;
    }

    // ---------------------------------------------------------------- launch (as version 1)

    /**
     * Launches a coin for `creator` (msg.sender if zero). msg.value = launchFee + the first buy (may
     * be zero). The first buy's coins go to the creator; `minOut` protects it.
     */
    function launch(string calldata name, string calldata symbol, string calldata uri, address creator, uint256 minOut)
        external
        payable
        nonReentrant
        returns (address coin, uint256 bought)
    {
        if (paused) revert Paused();
        if (bytes(name).length == 0 || bytes(symbol).length == 0) revert EmptyName();
        if (msg.value < launchFee) revert FeeNotPaid();
        if (creator == address(0)) creator = msg.sender;
        // fees sent to these could never be taken out by anyone
        if (creator == address(this) || creator == address(wrapped)) revert BadCreator();

        // CREATE2 with a salt nobody can know before the block: a coin's address can't be guessed ahead
        // of time to set up its pool at a wrong price (which would block launches)
        bytes32 salt = keccak256(abi.encode(msg.sender, creator, allCoins.length, block.number, block.timestamp, name, symbol));
        coin = address(new ArkhamPadCoin{salt: salt}(name, symbol, uri, SUPPLY, creator));
        bool coinIsToken0 = coin < address(wrapped);
        (address pool, uint256 tokenId) = _pool(coin, coinIsToken0);
        coins[coin] = Coin(tokenId, pool, creator, BASE_CREATOR_BPS, coinIsToken0);
        State storage s = states[coin];
        s.level1Mc = uint128(level1Mc);
        s.level2Mc = uint128(level2Mc);
        s.launchedAt = uint40(block.timestamp);
        allCoins.push(coin);

        if (launchFee > 0) _sendNative(treasury, launchFee);
        uint256 buyIn = msg.value - launchFee;
        if (buyIn > 0) bought = _buy(pool, coinIsToken0, buyIn, creator);
        if (bought < minOut) revert TooLittleOut();

        emit Launched(coin, creator, pool, tokenId, name, symbol, uri, startMc, buyIn, bought);
    }

    /// Creates the pool at the start price and puts the whole supply into it as one-sided liquidity.
    function _pool(address coin, bool coinIsToken0) private returns (address pool, uint256 tokenId) {
        int24 sp = tickSpacing;
        int24 maxTick = (TickMath.MAX_TICK / sp) * sp;
        int24 minTick = -maxTick;
        int24 tickLower;
        int24 tickUpper;
        uint160 sqrtStart;
        if (coinIsToken0) {
            uint256 sqrtP = Math.sqrt(Math.mulDiv(startMc, 1 << 96, SUPPLY)) << 48;
            int24 t = _floor(TickMath.getTickAtSqrtPrice(uint160(sqrtP)), sp);
            tickLower = t;
            tickUpper = maxTick;
            sqrtStart = TickMath.getSqrtPriceAtTick(t);
        } else {
            uint256 sqrtP = Math.sqrt(Math.mulDiv(SUPPLY, 1 << 96, startMc)) << 48;
            int24 t = _floor(TickMath.getTickAtSqrtPrice(uint160(sqrtP)), sp);
            tickLower = minTick;
            tickUpper = t;
            sqrtStart = TickMath.getSqrtPriceAtTick(t);
        }
        (address token0, address token1) = coinIsToken0 ? (coin, address(wrapped)) : (address(wrapped), coin);
        pool = positions.createAndInitializePoolIfNecessary(token0, token1, fee, sqrtStart);
        // someone else opened this pool first, at another price: refuse (try again; the next try gets a new address)
        (uint160 sqrtNow,,,,,,) = IV3PoolSlot0(pool).slot0();
        if (sqrtNow != sqrtStart) revert PoolTaken();

        IERC20(coin).forceApprove(address(positions), SUPPLY);
        (tokenId,,,) = positions.mint(
            IV3PositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: fee,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: coinIsToken0 ? SUPPLY : 0,
                amount1Desired: coinIsToken0 ? 0 : SUPPLY,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
        uint256 left = IERC20(coin).balanceOf(address(this));
        if (left > 0) IERC20(coin).safeTransfer(DEAD, left);
    }

    /// The first buy, straight against the pool (no router), coins to `to`.
    function _buy(address pool, bool coinIsToken0, uint256 amountIn, address to) private returns (uint256 out) {
        wrapped.deposit{value: amountIn}();
        bool zeroForOne = !coinIsToken0; // paying with the wrapped native token
        swapping = pool;
        (int256 a0, int256 a1) = IV3Pool(pool).swap(
            to, zeroForOne, int256(amountIn), zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1, ""
        );
        swapping = address(0);
        int256 coinDelta = coinIsToken0 ? a0 : a1;
        int256 paid = coinIsToken0 ? a1 : a0;
        out = uint256(-coinDelta);
        uint256 rest = amountIn - uint256(paid);
        if (rest > 0) {
            wrapped.withdraw(rest);
            _sendNative(to, rest);
        }
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != swapping || swapping == address(0)) revert BadCallback();
        uint256 owed = uint256(amount0Delta > 0 ? amount0Delta : amount1Delta);
        IERC20(address(wrapped)).safeTransfer(msg.sender, owed);
    }

    // ---------------------------------------------------------------- market cap and the fee share now

    /// The coin's market cap right now, in native wei: pool price x the whole supply.
    function marketCap(address coin) public view returns (uint256) {
        Coin memory c = coins[coin];
        if (c.pool == address(0)) revert UnknownCoin();
        (uint160 sqrtP,,,,,,) = IV3PoolSlot0(c.pool).slot0();
        return _mcAt(sqrtP, c.coinIsToken0);
    }

    function _mcAt(uint160 sqrtP, bool coinIsToken0) private pure returns (uint256) {
        if (coinIsToken0) {
            // price (native per coin) = sqrtP^2 / 2^192; market cap = price x SUPPLY
            // (split as 2^96 x 2^96 so nothing overflows even at the highest possible price)
            return Math.mulDiv(Math.mulDiv(sqrtP, sqrtP, 1 << 96), SUPPLY, 1 << 96);
        }
        // price (coins per native) = sqrtP^2 / 2^192; market cap = SUPPLY / price
        return Math.mulDiv(Math.mulDiv(SUPPLY, 1 << 96, sqrtP), 1 << 96, sqrtP);
    }

    /// The creator's share (bps) of fees collected now, and the part held for them.
    function sharesNow(address coin) public view returns (uint16 creatorBps, uint16 heldBps) {
        State storage s = states[coin];
        if (s.level == 2) return (LEVEL2_CREATOR_BPS, 0);
        if (s.level == 1) return (LEVEL1_CREATOR_BPS, 0);
        bool holding = !s.heldSettled && block.timestamp <= uint256(s.launchedAt) + WINDOW;
        return (BASE_CREATOR_BPS, holding ? HELD_BPS : 0);
    }

    /// Everything a coin page needs in one read.
    function status(address coin)
        external
        view
        returns (
            uint8 level,
            uint16 creatorBps,
            uint16 heldBps,
            uint256 marketCapNow,
            uint256 level1,
            uint256 level2,
            uint256 launchedAt,
            uint256 aboveSince,
            uint256 heldNative,
            uint256 heldCoin,
            bool heldSettled
        )
    {
        State storage s = states[coin];
        (creatorBps, heldBps) = sharesNow(coin);
        return (
            s.level,
            creatorBps,
            heldBps,
            marketCap(coin),
            s.level1Mc,
            s.level2Mc,
            s.launchedAt,
            s.aboveSince,
            s.heldNative,
            s.heldCoin,
            s.heldSettled
        );
    }

    // ---------------------------------------------------------------- fees

    /// Collects a coin's pool fees and splits them at its current share. Anyone can call it.
    function collect(address coin) public nonReentrant returns (uint256 coinAmount, uint256 nativeAmount) {
        return _collect(coin);
    }

    function collectMany(address[] calldata list) external {
        for (uint256 i; i < list.length; ++i) collect(list[i]);
    }

    function _collect(address coin) private returns (uint256 coinAmount, uint256 nativeAmount) {
        Coin memory c = coins[coin];
        if (c.pool == address(0)) revert UnknownCoin();
        (uint256 a0, uint256 a1) = positions.collect(
            IV3PositionManager.CollectParams(c.tokenId, address(this), type(uint128).max, type(uint128).max)
        );
        (coinAmount, nativeAmount) = c.coinIsToken0 ? (a0, a1) : (a1, a0);
        if (coinAmount == 0 && nativeAmount == 0) return (0, 0);
        (uint16 creatorBps, uint16 heldBps) = sharesNow(coin);

        uint256 coinCreator = (coinAmount * creatorBps) / 10_000;
        uint256 coinHeld = (coinAmount * heldBps) / 10_000;
        uint256 nativeCreator = (nativeAmount * creatorBps) / 10_000;
        uint256 nativeHeld = (nativeAmount * heldBps) / 10_000;

        if (coinHeld > 0 || nativeHeld > 0) {
            State storage s = states[coin];
            s.heldCoin += coinHeld;
            s.heldNative += nativeHeld;
            heldNativeTotal += nativeHeld;
            emit FeesHeld(coin, coinHeld, nativeHeld);
        }
        if (coinCreator > 0) IERC20(coin).safeTransfer(c.creator, coinCreator);
        uint256 coinTreasury = coinAmount - coinCreator - coinHeld;
        if (coinTreasury > 0) IERC20(coin).safeTransfer(treasury, coinTreasury);
        // HYPE fees are paid out as native HYPE; the held part stays here as native
        if (nativeAmount > 0) wrapped.withdraw(nativeAmount);
        if (nativeCreator > 0) _sendNative(c.creator, nativeCreator);
        uint256 nativeTreasury = nativeAmount - nativeCreator - nativeHeld;
        if (nativeTreasury > 0) _sendNative(treasury, nativeTreasury);
        emit FeesCollected(coin, coinCreator, coinTreasury, nativeCreator, nativeTreasury);
    }

    // ---------------------------------------------------------------- levels (keeper)

    /**
     * Checks a coin's market cap and moves it between levels. Collects first, so the fees earned since the
     * previous check go out at the share that was in force while they were earned. Then settles the held
     * share once its outcome is known.
     */
    function poke(address coin) public nonReentrant {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _poke(coin);
    }

    function pokeMany(address[] calldata list) external nonReentrant {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        for (uint256 i; i < list.length; ++i) _poke(list[i]);
    }

    function _poke(address coin) private {
        // read the market cap first: nothing that happens while fees are paid out below can change it
        uint256 mc = marketCap(coin);
        _collect(coin);
        State storage s = states[coin];
        Checks storage k = checks[coin];
        uint8 before = s.level;
        if (mc < s.level1Mc) {
            s.aboveSince = 0;
            s.level = 0;
            k.above1 = 0;
            k.above2 = 0;
        } else {
            if (s.aboveSince == 0) s.aboveSince = uint40(block.timestamp);
            if (k.above1 < type(uint16).max) k.above1++;
            if (mc >= s.level2Mc) {
                if (k.above2 < type(uint16).max) k.above2++;
            } else {
                k.above2 = 0;
            }
            if (block.timestamp >= uint256(s.aboveSince) + HOLD && k.above1 >= MIN_CHECKS) {
                s.level = k.above2 >= L2_CHECKS ? 2 : 1;
            }
        }
        if (s.level != before) emit LevelChanged(coin, s.level, mc);

        if (!s.heldSettled) {
            uint256 deadline = uint256(s.launchedAt) + WINDOW;
            if (s.level > 0 && s.aboveSince <= deadline) {
                // reached the level, with its hour above it starting within the first 24 hours
                _settleHeld(coin, s, coins[coin].creator, true);
            } else if (block.timestamp > deadline && (s.aboveSince == 0 || s.aboveSince > deadline)) {
                // the first 24 hours are over and no qualifying hour is running: it can't happen any more
                _settleHeld(coin, s, treasury, false);
            }
        }
    }

    function _settleHeld(address coin, State storage s, address to, bool toCreator) private {
        uint256 n = s.heldNative;
        uint256 k = s.heldCoin;
        s.heldSettled = true;
        s.heldNative = 0;
        s.heldCoin = 0;
        heldNativeTotal -= n;
        if (k > 0) IERC20(coin).safeTransfer(to, k);
        if (n > 0) _sendNative(to, n);
        if (toCreator) emit HeldReleased(coin, to, k, n);
        else emit HeldToTreasury(coin, k, n);
    }

    // ---------------------------------------------------------------- helpers

    function _floor(int24 tick, int24 sp) private pure returns (int24) {
        int24 r = tick / sp;
        if (tick < 0 && tick % sp != 0) r--;
        return r * sp;
    }

    function _sendNative(address to, uint256 amount) private {
        // a fixed, small amount of gas and no return data copied: a receiver can't trade, re-enter anything
        // useful, or make the payout run out of gas
        bool ok;
        assembly {
            ok := call(SEND_GAS, to, amount, 0, 0, 0, 0)
        }
        if (!ok) {
            // a contract that can't take native gets the wrapped token instead
            wrapped.deposit{value: amount}();
            IERC20(address(wrapped)).safeTransfer(to, amount);
        }
    }

    /// The position NFTs never leave this contract; accepting them is all this does.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    receive() external payable {
        // only the wrapped-native contract sends native here (fee withdrawals, refund of an unused first buy)
        if (msg.sender != address(wrapped)) revert BadCallback();
    }
}
