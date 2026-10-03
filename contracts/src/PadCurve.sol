// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PadCoin} from "./PadCoin.sol";
import {IPadHub, IPadPoolBuilder} from "./interfaces.sol";

/// @title PadCurve
/// @notice The bonding curve of one ArkhamPad coin, priced in USDC.
///
/// Price follows a constant product on virtual reserves:
///     vUsdc * vCoin = k
/// Buying adds USDC and removes coins, so the price rises; selling does the
/// opposite. Anyone can buy or sell at any time while the curve is open.
///
/// Life of a curve:
///   Open      - buy and sell.
///   Full      - every coin for sale has been bought. Trading stops and anyone
///               may call `graduate()`.
///   Graduated - the curve's USDC (minus the graduation fee) and a matching
///               amount of coins went to the pool builder, which locks them as
///               DEX liquidity at the curve's final price. Leftover coins are
///               burned.
///
/// Nobody, including the admin, can take users' money out of a curve. The
/// admin can only pause new buys; sells, fee claims and graduation keep working.
///
/// Fees (in USDC) on every trade: `TRADE_FEE_BPS`, charged on top of buys and
/// taken out of sells. `CREATOR_CUT_BPS` of it belongs to the coin (paid to the
/// creator, or used to buy back and burn the coin), the rest to the platform.
/// The creator's own launch buy pays the full fee to the platform.
/// At graduation, `GRADUATION_FEE_BPS` of the curve's USDC goes to the platform.
contract PadCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Phase {
        Open,
        Full,
        Graduated
    }

    enum FeeMode {
        ToCreator,
        BuybackBurn
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant TRADE_FEE_BPS = 100; // 1%
    uint256 public constant CREATOR_CUT_BPS = 3_000; // 30% of the trade fee
    uint256 public constant GRADUATION_FEE_BPS = 200; // 2% of the curve's USDC
    /// @notice Largest single buyback on the curve, as a share of vUsdc (0.5%),
    /// so a buyback moves the price far less than a round trip costs in fees.
    uint256 public constant BUYBACK_STEP_BPS = 50;
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    IPadHub public immutable hub;
    IERC20 public immutable usdc;
    PadCoin public immutable coin;
    IPadPoolBuilder public immutable poolBuilder;
    address public immutable creator;
    FeeMode public immutable feeMode;
    uint256 public immutable startVUsdc;
    uint256 public immutable startVCoin;

    Phase public phase;
    uint256 public vUsdc;
    uint256 public vCoin;
    /// @notice USDC actually paid in for coins still held by buyers.
    uint256 public usdcReserve;
    /// @notice Coins the curve can still sell.
    uint256 public coinsForSale;
    /// @notice Coins kept back for the pool; any surplus is burned at graduation.
    uint256 public coinsReserved;

    uint256 public creatorFees;
    uint256 public platformFees;
    bool private _launchBuyUsed;

    event Trade(
        address indexed trader,
        bool indexed isBuy,
        uint256 usdcAmount,
        uint256 coinAmount,
        uint256 fee,
        uint256 vUsdcAfter,
        uint256 vCoinAfter
    );
    event CurveFull(uint256 usdcReserve);
    event Graduated(uint256 usdcToPool, uint256 coinsToPool, uint256 coinsBurned, uint256 graduationFee);
    event CreatorFeesPaid(address indexed to, uint256 amount);
    event PlatformFeesPaid(address indexed to, uint256 amount);
    event BuybackBurned(uint256 usdcSpent, uint256 coinsBurned);
    event BuybackForwarded(uint256 usdcAmount);

    error NotOpen();
    error NotFull();
    error AlreadyGraduated();
    error NothingToDo();
    error Slippage(uint256 got, uint256 minimum);
    error BuysPaused();
    error OnlyHub();
    error BadConfig();

    struct Config {
        string name;
        string symbol;
        string metadataURI;
        address creator;
        uint256 lockSeconds;
        FeeMode feeMode;
        IERC20 usdc;
        IPadPoolBuilder poolBuilder;
        uint256 vUsdc;
        uint256 vCoin;
        uint256 coinsForSale;
        uint256 coinsReserved;
    }

    constructor(Config memory c) {
        if (
            c.creator == address(0) || address(c.usdc) == address(0) || address(c.poolBuilder) == address(0) || c.vUsdc == 0
                || c.coinsForSale == 0 || c.vCoin <= c.coinsForSale
        ) revert BadConfig();
        hub = IPadHub(msg.sender);
        usdc = c.usdc;
        poolBuilder = c.poolBuilder;
        creator = c.creator;
        feeMode = c.feeMode;
        startVUsdc = c.vUsdc;
        startVCoin = c.vCoin;
        vUsdc = c.vUsdc;
        vCoin = c.vCoin;
        coinsForSale = c.coinsForSale;
        coinsReserved = c.coinsReserved;
        coin = new PadCoin(
            c.name, c.symbol, c.metadataURI, c.coinsForSale + c.coinsReserved, address(this), c.creator, c.lockSeconds
        );
    }

    // ---------------------------------------------------------------- trade

    /// @notice Buys coins with up to `usdcIn` USDC pulled from the caller.
    /// If the curve fills up, only the USDC actually needed is pulled.
    function buy(uint256 usdcIn, uint256 minCoinsOut, address to) external nonReentrant returns (uint256 coinsOut) {
        if (hub.buysPaused()) revert BuysPaused();
        coinsOut = _buy(usdcIn, minCoinsOut, to, false);
    }

    /// @notice The creator's buy at launch, made by the hub in the same
    /// transaction as the coin's creation. The whole fee goes to the platform.
    function launchBuy(uint256 usdcIn, uint256 minCoinsOut, address to) external nonReentrant returns (uint256 coinsOut) {
        if (msg.sender != address(hub) || _launchBuyUsed) revert OnlyHub();
        _launchBuyUsed = true;
        coinsOut = _buy(usdcIn, minCoinsOut, to, true);
    }

    function _buy(uint256 usdcIn, uint256 minCoinsOut, address to, bool launch) private returns (uint256 coinsOut) {
        if (phase != Phase.Open) revert NotOpen();
        if (usdcIn == 0) revert NothingToDo();

        uint256 v = vUsdc;
        uint256 t = vCoin;
        uint256 k = v * t;

        // The fee is added on top: net * (1 + fee) <= usdcIn.
        uint256 net = (usdcIn * BPS) / (BPS + TRADE_FEE_BPS);
        coinsOut = t - _divUp(k, v + net);
        bool fills = false;
        if (coinsOut >= coinsForSale) {
            coinsOut = coinsForSale;
            net = _divUp(k, t - coinsOut) - v;
            fills = true;
        }
        if (coinsOut == 0) revert NothingToDo();
        if (coinsOut < minCoinsOut) revert Slippage(coinsOut, minCoinsOut);

        uint256 fee = _divUp(net * TRADE_FEE_BPS, BPS);
        uint256 cost = net + fee;

        vUsdc = v + net;
        vCoin = t - coinsOut;
        usdcReserve += net;
        coinsForSale -= coinsOut;
        _splitFee(fee, launch);

        emit Trade(msg.sender, true, cost, coinsOut, fee, v + net, t - coinsOut);
        if (fills) {
            phase = Phase.Full;
            emit CurveFull(usdcReserve);
        }

        usdc.safeTransferFrom(msg.sender, address(this), cost);
        IERC20(address(coin)).safeTransfer(to, coinsOut);
    }

    /// @notice Sells `coinAmount` coins back to the curve (approve it first).
    function sell(uint256 coinAmount, uint256 minUsdcOut, address to) external nonReentrant returns (uint256 usdcOut) {
        if (phase != Phase.Open) revert NotOpen();
        if (coinAmount == 0) revert NothingToDo();

        uint256 v = vUsdc;
        uint256 t = vCoin;
        uint256 gross = v - _divUp(v * t, t + coinAmount);
        // Cannot happen (the reserve always covers every coin sold); a hard stop anyway.
        if (gross > usdcReserve) revert BadConfig();

        usdcOut = (gross * BPS) / (BPS + TRADE_FEE_BPS);
        uint256 fee = gross - usdcOut;
        if (usdcOut == 0) revert NothingToDo();
        if (usdcOut < minUsdcOut) revert Slippage(usdcOut, minUsdcOut);

        vUsdc = v - gross;
        vCoin = t + coinAmount;
        usdcReserve -= gross;
        coinsForSale += coinAmount;
        _splitFee(fee, false);

        emit Trade(msg.sender, false, usdcOut, coinAmount, fee, v - gross, t + coinAmount);

        IERC20(address(coin)).safeTransferFrom(msg.sender, address(this), coinAmount);
        usdc.safeTransfer(to, usdcOut);
    }

    // ---------------------------------------------------------------- quotes

    /// @notice Coins `usdcIn` would buy right now (capped at what is left).
    function quoteBuy(uint256 usdcIn) external view returns (uint256 coinsOut) {
        uint256 net = (usdcIn * BPS) / (BPS + TRADE_FEE_BPS);
        coinsOut = vCoin - _divUp(vUsdc * vCoin, vUsdc + net);
        if (coinsOut > coinsForSale) coinsOut = coinsForSale;
    }

    /// @notice USDC a sale of `coinAmount` would pay out right now.
    function quoteSell(uint256 coinAmount) external view returns (uint256) {
        uint256 gross = vUsdc - _divUp(vUsdc * vCoin, vCoin + coinAmount);
        return (gross * BPS) / (BPS + TRADE_FEE_BPS);
    }

    /// @notice Market cap in USDC (6 decimals) at the current curve price.
    function marketCap() external view returns (uint256) {
        return (vUsdc * coin.totalSupply()) / vCoin;
    }

    // ---------------------------------------------------------------- graduation

    /// @notice Moves a full curve into locked DEX liquidity. Anyone can call it.
    function graduate() external nonReentrant {
        if (phase == Phase.Graduated) revert AlreadyGraduated();
        if (phase != Phase.Full) revert NotFull();
        phase = Phase.Graduated;

        uint256 reserve = usdcReserve;
        uint256 gradFee = (reserve * GRADUATION_FEE_BPS) / BPS;
        uint256 toPool = reserve - gradFee;
        // Same price as the curve's last price.
        uint256 coinsToPool = (toPool * vCoin) / vUsdc;
        uint256 held = coinsReserved + coinsForSale;
        if (coinsToPool > held) coinsToPool = held;
        uint256 burn = held - coinsToPool;

        usdcReserve = 0;
        coinsReserved = 0;
        coinsForSale = 0;
        platformFees += gradFee;

        emit Graduated(toPool, coinsToPool, burn, gradFee);

        IERC20 c = IERC20(address(coin));
        if (burn > 0) c.safeTransfer(BURN, burn);
        c.safeTransfer(address(poolBuilder), coinsToPool);
        usdc.safeTransfer(address(poolBuilder), toPool);
        poolBuilder.buildPool(address(coin), coinsToPool, toPool);
    }

    // ---------------------------------------------------------------- fees

    /// @notice Uses the coin's share of fees as its fee mode says. Anyone can call.
    ///  ToCreator:   paid to the creator.
    ///  BuybackBurn: spent buying the coin and burning it - on the curve while
    ///               open (one small step per call), in the pool after graduation.
    function settleCreatorFees() external nonReentrant returns (uint256 used) {
        uint256 have = creatorFees;
        if (have == 0) return 0;
        if (feeMode == FeeMode.ToCreator) {
            creatorFees = 0;
            emit CreatorFeesPaid(creator, have);
            usdc.safeTransfer(creator, have);
            return have;
        }
        if (phase == Phase.Open) return _buybackOnCurve(have);
        if (phase == Phase.Graduated) {
            creatorFees = 0;
            emit BuybackForwarded(have);
            usdc.forceApprove(address(poolBuilder), have);
            poolBuilder.fundBuyback(address(coin), have);
            usdc.forceApprove(address(poolBuilder), 0);
            return have;
        }
        return 0; // Full: waits for graduation.
    }

    function _buybackOnCurve(uint256 have) private returns (uint256 spent) {
        uint256 v = vUsdc;
        uint256 t = vCoin;
        spent = have;
        uint256 step = (v * BUYBACK_STEP_BPS) / BPS;
        if (spent > step) spent = step;
        uint256 out = t - _divUp(v * t, v + spent);
        // Never fill the curve with fee money; the rest waits for graduation.
        if (out == 0 || out >= coinsForSale) return 0;

        creatorFees = have - spent;
        vUsdc = v + spent;
        vCoin = t - out;
        usdcReserve += spent;
        coinsForSale -= out;
        emit Trade(BURN, true, spent, out, 0, v + spent, t - out);
        emit BuybackBurned(spent, out);
        IERC20(address(coin)).safeTransfer(BURN, out);
    }

    /// @notice Sends the platform's fees to the treasury. Anyone can call.
    function claimPlatformFees() external nonReentrant returns (uint256 amount) {
        amount = platformFees;
        if (amount == 0) return 0;
        platformFees = 0;
        address to = hub.treasury();
        emit PlatformFeesPaid(to, amount);
        usdc.safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- helpers

    function _splitFee(uint256 fee, bool launch) private {
        uint256 toCoin = launch ? 0 : (fee * CREATOR_CUT_BPS) / BPS;
        creatorFees += toCoin;
        platformFees += fee - toCoin;
    }

    function _divUp(uint256 a, uint256 b) private pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
