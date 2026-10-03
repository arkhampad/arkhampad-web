// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSDC
/// @notice Testnet-only dollar for chains without a USDC faucet. Anyone can
/// mint up to 100 per call. Never deployed on mainnet.
contract TestUSDC is ERC20 {
    uint256 public constant MAX_MINT = 100e6;

    error TooMuch();

    constructor() ERC20("Test USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT) revert TooMuch();
        _mint(to, amount);
    }
}
