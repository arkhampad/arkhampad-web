// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ArkhamPadCoin} from "./PadCoin.sol";
import {FeeMode} from "./PadTypes.sol";
import {IPadPoolBuilder} from "./interfaces.sol";

/// @title PadHub
/// @notice Creates ArkhamPad coins on one chain and keeps the few settings
/// they share. Launching is free; the creator may buy in the same transaction.
///
/// Every coin goes straight into a Uniswap v4 pool at launch: the whole supply
/// (1 billion coins, minted once, no owner, no minting later) becomes locked
/// liquidity that starts at `startMarketCap` and covers every higher price.
///
/// Roles:
///   admin    - sets the treasury, the guardian and can pause/unpause launches.
///              Two-step transfer. Cannot touch any coin's or user's funds.
///   guardian - can only pause new launches (for emergencies). Only the admin
///              unpauses. Trading in the pools can never be paused by anyone.
contract PadHub is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant SUPPLY = 1_000_000_000e18;

    IERC20 public immutable usdc;
    IPadPoolBuilder public immutable poolBuilder;
    /// @notice Launch market cap in USDC (the dollar token's own decimals) for the whole supply.
    uint256 public immutable startMarketCap;
    /// @notice Every launch includes a creator buy of at least this much (the dollar token's
    /// own decimals): the pool's first trade happens at launch, so the coin shows up on DEX
    /// screeners right away, and only people who actually put money in can launch.
    uint256 public immutable minLaunchBuy;

    address public admin;
    address public pendingAdmin;
    address public guardian;
    address public treasury;
    address public router;
    bool public buysPaused;

    mapping(address => bool) public isCoin;
    address[] public allCoins;

    event CoinCreated(
        address indexed coin,
        address indexed creator,
        string name,
        string symbol,
        string metadataURI,
        uint256 lockSeconds,
        FeeMode feeMode
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
    error LaunchBuyTooSmall(uint256 minimum);

    constructor(
        IERC20 usdc_,
        IPadPoolBuilder poolBuilder_,
        uint256 startMarketCap_,
        uint256 minLaunchBuy_,
        address admin_,
        address treasury_
    ) {
        if (address(usdc_) == address(0) || address(poolBuilder_) == address(0) || admin_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        usdc = usdc_;
        poolBuilder = poolBuilder_;
        if (startMarketCap_ == 0) revert BadName();
        // review L-01: a zero minimum would let launches skip the first buy
        if (minLaunchBuy_ == 0) revert LaunchBuyTooSmall(0);
        startMarketCap = startMarketCap_;
        minLaunchBuy = minLaunchBuy_;
        admin = admin_;
        treasury = treasury_;
    }

    // ---------------------------------------------------------------- create

    /// @notice Creates a coin, opens its pool and makes the creator's launch buy
    /// (at least `minLaunchBuy`, at the normal 2% fee; approve the hub for that much USDC first).
    function createCoin(
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        uint256 lockSeconds,
        FeeMode feeMode,
        uint256 launchUsdc,
        uint256 minCoinsOut
    ) external nonReentrant returns (address coin) {
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
        FeeMode feeMode,
        uint256 launchUsdc,
        uint256 minCoinsOut
    ) external nonReentrant returns (address coin) {
        if (msg.sender != router || creator == address(0)) revert NotAllowed();
        return _create(creator, name, symbol, metadataURI, lockSeconds, feeMode, launchUsdc, minCoinsOut);
    }

    function _create(
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        uint256 lockSeconds,
        FeeMode feeMode,
        uint256 launchUsdc,
        uint256 minCoinsOut
    ) private returns (address coin) {
        uint256 nl = bytes(name).length;
        uint256 sl = bytes(symbol).length;
        if (nl == 0 || nl > 32 || sl == 0 || sl > 10) revert BadName();
        if (buysPaused) revert NotAllowed();
        if (launchUsdc < minLaunchBuy || launchUsdc == 0) revert LaunchBuyTooSmall(minLaunchBuy);

        // The whole supply is minted to the pool builder, which puts it all into the pool.
        coin = address(new ArkhamPadCoin(name, symbol, metadataURI, SUPPLY, address(poolBuilder), creator, lockSeconds));
        isCoin[coin] = true;
        allCoins.push(coin);
        emit CoinCreated(coin, creator, name, symbol, metadataURI, lockSeconds, feeMode);
        poolBuilder.launchPool(coin, SUPPLY, startMarketCap, creator, feeMode);

        usdc.safeTransferFrom(msg.sender, address(poolBuilder), launchUsdc);
        poolBuilder.launchBuy(coin, launchUsdc, minCoinsOut, creator);
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
