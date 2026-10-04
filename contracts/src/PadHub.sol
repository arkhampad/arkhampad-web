// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PadCurve} from "./PadCurve.sol";
import {IPadPoolBuilder} from "./interfaces.sol";

/// @title PadHub
/// @notice Creates ArkhamPad coins on one chain and keeps the few settings
/// they share. Launching is free; the creator may buy in the same transaction.
///
/// Roles:
///   admin    - sets the treasury, the guardian and can pause/unpause buys.
///              Two-step transfer. Cannot touch any coin's or user's funds.
///   guardian - can only pause new buys (for emergencies). Only the admin
///              unpauses. Sells, fee claims and graduation are never paused.
contract PadHub is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct CurveParams {
        uint256 vUsdc; // starting virtual USDC (6 decimals) = starting market cap when vCoin == supply
        uint256 vCoin; // starting virtual coins (18 decimals)
        uint256 coinsForSale; // coins sold on the curve before it is full
        uint256 coinsReserved; // coins kept for the pool (surplus burned)
    }

    IERC20 public immutable usdc;
    IPadPoolBuilder public immutable poolBuilder;
    uint256 public immutable vUsdcStart;
    uint256 public immutable vCoinStart;
    uint256 public immutable coinsForSaleStart;
    uint256 public immutable coinsReservedStart;

    address public admin;
    address public pendingAdmin;
    address public guardian;
    address public treasury;
    address public router;
    bool public buysPaused;

    mapping(address => address) public curveOf; // coin => curve
    mapping(address => bool) public isCurve;
    address[] public allCoins;

    event CoinCreated(
        address indexed coin,
        address indexed curve,
        address indexed creator,
        string name,
        string symbol,
        string metadataURI,
        uint256 lockSeconds,
        PadCurve.FeeMode feeMode
    );
    event TreasuryChanged(address treasury);
    event GuardianChanged(address guardian);
    event AdminProposed(address admin);
    event AdminChanged(address admin);
    event BuysPaused(bool paused);
    event RouterChanged(address router);

    error NotAdmin();
    error NotAllowed();
    error ZeroAddress();
    error BadName();

    constructor(IERC20 usdc_, IPadPoolBuilder poolBuilder_, CurveParams memory p, address admin_, address treasury_) {
        if (address(usdc_) == address(0) || address(poolBuilder_) == address(0) || admin_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        usdc = usdc_;
        poolBuilder = poolBuilder_;
        vUsdcStart = p.vUsdc;
        vCoinStart = p.vCoin;
        coinsForSaleStart = p.coinsForSale;
        coinsReservedStart = p.coinsReserved;
        admin = admin_;
        treasury = treasury_;
    }

    // ---------------------------------------------------------------- create

    /// @notice Creates a coin. `launchUsdc` > 0 also buys it for the creator
    /// (approve the hub for that much USDC first).
    function createCoin(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        uint256 lockSeconds,
        PadCurve.FeeMode feeMode,
        uint256 launchUsdc,
        uint256 minCoinsOut
    ) external nonReentrant returns (address coin, address curve) {
        return _create(msg.sender, name, symbol, metadataURI, lockSeconds, feeMode, launchUsdc, minCoinsOut);
    }

    /// @notice Same as createCoin, for a creator who signed the request to the
    /// router (gasless launches). Only the router set by the admin may call it.
    /// The launch buy is paid by the router and the coins go to `creator`.
    function createCoinFor(
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        uint256 lockSeconds,
        PadCurve.FeeMode feeMode,
        uint256 launchUsdc,
        uint256 minCoinsOut
    ) external nonReentrant returns (address coin, address curve) {
        if (msg.sender != router || creator == address(0)) revert NotAllowed();
        return _create(creator, name, symbol, metadataURI, lockSeconds, feeMode, launchUsdc, minCoinsOut);
    }

    function _create(
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        uint256 lockSeconds,
        PadCurve.FeeMode feeMode,
        uint256 launchUsdc,
        uint256 minCoinsOut
    ) private returns (address coin, address curve) {
        uint256 nl = bytes(name).length;
        uint256 sl = bytes(symbol).length;
        if (nl == 0 || nl > 32 || sl == 0 || sl > 10) revert BadName();

        PadCurve c = new PadCurve(
            PadCurve.Config({
                name: name,
                symbol: symbol,
                metadataURI: metadataURI,
                creator: creator,
                lockSeconds: lockSeconds,
                feeMode: feeMode,
                usdc: usdc,
                poolBuilder: poolBuilder,
                vUsdc: vUsdcStart,
                vCoin: vCoinStart,
                coinsForSale: coinsForSaleStart,
                coinsReserved: coinsReservedStart
            })
        );
        curve = address(c);
        coin = address(c.coin());
        curveOf[coin] = curve;
        isCurve[curve] = true;
        allCoins.push(coin);
        emit CoinCreated(coin, curve, creator, name, symbol, metadataURI, lockSeconds, feeMode);

        if (launchUsdc > 0) {
            if (buysPaused) revert NotAllowed();
            usdc.safeTransferFrom(msg.sender, address(this), launchUsdc);
            usdc.forceApprove(curve, launchUsdc);
            c.launchBuy(launchUsdc, minCoinsOut, creator);
            usdc.forceApprove(curve, 0);
            // A launch buy that fills the curve spends less than launchUsdc: refund the payer.
            uint256 left = usdc.balanceOf(address(this));
            if (left > 0) usdc.safeTransfer(msg.sender, left);
        }
    }

    function coinCount() external view returns (uint256) {
        return allCoins.length;
    }

    // ---------------------------------------------------------------- admin

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    function pauseBuys() external {
        if (msg.sender != admin && msg.sender != guardian) revert NotAllowed();
        buysPaused = true;
        emit BuysPaused(true);
    }

    function unpauseBuys() external onlyAdmin {
        buysPaused = false;
        emit BuysPaused(false);
    }

    function setTreasury(address t) external onlyAdmin {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasuryChanged(t);
    }

    /// @notice The gasless router allowed to call createCoinFor (zero turns it off).
    function setRouter(address r) external onlyAdmin {
        router = r;
        emit RouterChanged(r);
    }

    function setGuardian(address g) external onlyAdmin {
        guardian = g;
        emit GuardianChanged(g);
    }

    function proposeAdmin(address a) external onlyAdmin {
        pendingAdmin = a;
        emit AdminProposed(a);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotAllowed();
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminChanged(admin);
    }
}
