// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Where a coin's 30% share of pool fees goes, chosen at launch and fixed.
///   ToCreator:    paid to the coin's creator.
///   BuybackBurn:  USDC buys the coin back in its pool and burns it; coin fees are burned.
enum FeeMode {
    ToCreator,
    BuybackBurn
}
