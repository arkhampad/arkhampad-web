// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title PadPromote
/// @notice Pays to show any coin (launched on ArkhamPad or not) in the
/// Promoted row for a while. Anyone can promote any coin. Payment in USDC goes
/// straight to the treasury; the site reads the events to show the row.
contract PadPromote {
    using SafeERC20 for IERC20;

    struct Plan {
        uint64 seconds_;
        uint128 price; // USDC, 6 decimals
        bool active;
    }

    IERC20 public immutable usdc;
    address public admin;
    address public treasury;
    mapping(uint8 => Plan) public plans;

    event Promoted(address indexed coin, uint256 indexed chainId, address indexed payer, uint8 plan, uint256 seconds_, uint256 price);
    event PlanSet(uint8 indexed plan, uint256 seconds_, uint256 price, bool active);
    event TreasuryChanged(address treasury);
    event AdminChanged(address admin);

    error NotAdmin();
    error NoSuchPlan();
    error ZeroAddress();

    constructor(IERC20 usdc_, address admin_, address treasury_) {
        if (address(usdc_) == address(0) || admin_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        admin = admin_;
        treasury = treasury_;
        // 6 hours $10, 24 hours $20, 7 days $99
        _setPlan(1, 6 hours, 10e6, true);
        _setPlan(2, 24 hours, 20e6, true);
        _setPlan(3, 7 days, 99e6, true);
    }

    /// @notice Promotes `coin` (a coin on chain `chainId`; any chain the site lists).
    function promote(address coin, uint256 chainId, uint8 plan) external {
        Plan memory p = plans[plan];
        if (!p.active || coin == address(0)) revert NoSuchPlan();
        emit Promoted(coin, chainId, msg.sender, plan, p.seconds_, p.price);
        usdc.safeTransferFrom(msg.sender, treasury, p.price);
    }

    function setPlan(uint8 plan, uint64 seconds_, uint128 price, bool active) external {
        if (msg.sender != admin) revert NotAdmin();
        _setPlan(plan, seconds_, price, active);
    }

    function setTreasury(address t) external {
        if (msg.sender != admin) revert NotAdmin();
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasuryChanged(t);
    }

    function setAdmin(address a) external {
        if (msg.sender != admin) revert NotAdmin();
        if (a == address(0)) revert ZeroAddress();
        admin = a;
        emit AdminChanged(a);
    }

    function _setPlan(uint8 plan, uint64 s, uint128 price, bool active) private {
        plans[plan] = Plan(s, price, active);
        emit PlanSet(plan, s, price, active);
    }
}
