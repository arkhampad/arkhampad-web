// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FeeMode} from "./PadTypes.sol";

/// @notice Opens a new coin's Uniswap pool at launch and holds its locked liquidity.
interface IPadPoolBuilder {
    /// @notice Puts `coinAmount` coins (already sent here) into a new pool at
    /// a launch price of `startMarketCap` USDC for the whole supply.
    function launchPool(address coin, uint256 coinAmount, uint256 startMarketCap, address creator, FeeMode feeMode) external;
    /// @notice The creator's launch buy: swaps `usdcAmount` (already sent here) for coins sent to `to`.
    function launchBuy(address coin, uint256 usdcAmount, uint256 minCoinsOut, address to) external returns (uint256 coinsOut);
}

interface IPadHub {
    function admin() external view returns (address);
    function buysPaused() external view returns (bool);
    function treasury() external view returns (address);
    function isCoin(address coin) external view returns (bool);
}
