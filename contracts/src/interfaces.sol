// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Receives a finished curve's USDC and coins (already transferred to
/// it) and turns them into permanently locked DEX liquidity.
interface IPadPoolBuilder {
    function buildPool(address coin, uint256 coinAmount, uint256 usdcAmount) external;
    /// @notice USDC from a graduated "buyback & burn" coin, to be spent buying
    /// the coin in its pool and burning it. Pulled from the caller.
    function fundBuyback(address coin, uint256 usdcAmount) external;
}

interface IPadHub {
    function admin() external view returns (address);
    function buysPaused() external view returns (bool);
    function treasury() external view returns (address);
}
