// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PadFeeVault
/// @notice ArkhamPad's treasury. Every platform fee lands here. The owner (the treasury wallet)
/// withdraws whenever it wants. The payer (the relayer's hot key) can only send referral payouts,
/// and only up to a daily limit in the dollar token, so a stolen server key can never empty it.
contract PadFeeVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public owner;
    address public pendingOwner;
    address public payer;
    /// @notice Most the payer can send per UTC day, in the dollar token's units.
    uint256 public dailyCap;
    uint256 public spentDay;
    uint256 public spentToday;

    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event ReferralPaid(address indexed to, uint256 amount, bytes32 indexed ref);
    event PayerChanged(address payer);
    event DailyCapChanged(uint256 cap);
    event OwnerProposed(address owner);
    event OwnerChanged(address owner);

    error NotOwner();
    error NotPayer();
    error ZeroAddress();
    error OverDailyCap(uint256 wanted, uint256 left);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IERC20 usdc_, address owner_, address payer_, uint256 dailyCap_) {
        // the payer must be set at deploy (it can be switched off later with setPayer(address(0)))
        if (address(usdc_) == address(0) || owner_ == address(0) || payer_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        owner = owner_;
        payer = payer_;
        dailyCap = dailyCap_;
        emit OwnerChanged(owner_);
        emit PayerChanged(payer_);
        emit DailyCapChanged(dailyCap_);
    }

    /// @notice What the payer can still send today.
    function leftToday() public view returns (uint256) {
        uint256 day = block.timestamp / 1 days;
        uint256 spent = day == spentDay ? spentToday : 0;
        return spent >= dailyCap ? 0 : dailyCap - spent;
    }

    /// @notice Referral payouts, sent automatically by the relayer. Limited per day.
    /// @param ref an id from the payout record, so every payment can be matched on-chain.
    function payReferral(address to, uint256 amount, bytes32 ref) external nonReentrant {
        if (msg.sender != payer) revert NotPayer();
        if (to == address(0)) revert ZeroAddress();
        uint256 day = block.timestamp / 1 days;
        if (day != spentDay) { spentDay = day; spentToday = 0; }
        uint256 left = dailyCap > spentToday ? dailyCap - spentToday : 0;
        if (amount > left) revert OverDailyCap(amount, left);
        spentToday += amount;
        emit ReferralPaid(to, amount, ref);
        usdc.safeTransfer(to, amount);
    }

    /// @notice The owner takes any token out (dollars, or coins from pool fees), any time.
    function withdraw(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        emit Withdrawn(address(token), to, amount);
        token.safeTransfer(to, amount);
    }

    function setPayer(address p) external onlyOwner {
        payer = p;
        emit PayerChanged(p);
    }

    function setDailyCap(uint256 cap) external onlyOwner {
        dailyCap = cap;
        emit DailyCapChanged(cap);
    }

    /// @notice Two-step ownership change, so a typo can't lock the treasury.
    function proposeOwner(address o) external onlyOwner {
        pendingOwner = o;
        emit OwnerProposed(o);
    }

    function acceptOwner() external {
        if (msg.sender != pendingOwner || pendingOwner == address(0)) revert NotOwner();
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnerChanged(owner);
    }
}
