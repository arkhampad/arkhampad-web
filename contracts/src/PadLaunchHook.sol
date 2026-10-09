// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title PadLaunchHook
/// @notice Uniswap v4 hook used by every ArkhamPad pool. It does two things only:
///   1. Nobody except the pool builder can create (initialize) a pool with this
///      hook, so no one can open a coin's pool early or at a bad price.
///   2. It sets the pool's trading fee. Every coin's pool opens at launch with a
///      fee of 10% that falls in a straight line to 2% over the first two
///      minutes, then stays at 2% forever. Bots that buy in the first seconds
///      pay the most. Swaps made by the pool builder itself (the creator's
///      launch buy and buybacks) always pay the normal 2%.
/// All fees go to the pool's only liquidity position, held and locked by the
/// pool builder, which splits them between the platform and the coin.
/// The hook holds no funds, never changes swap amounts and has no owner.
/// Deployed with CREATE2 so its address carries only the before-initialize and
/// before-swap flags.
contract PadLaunchHook {
    using PoolIdLibrary for PoolKey;

    /// @notice Fee units: 1_000_000 = 100%.
    uint24 public constant START_FEE = 100_000; // 10%
    uint24 public constant BASE_FEE = 20_000; // 2%
    uint256 public constant DECAY_SECONDS = 120; // two minutes

    address public immutable poolManager;
    address public immutable builder;

    /// @notice When each pool was created (its launch).
    mapping(PoolId => uint256) public launchedAt;

    error NotPoolManager();
    error NotBuilder();
    error NotAPadPool();

    constructor(address poolManager_, address builder_) {
        poolManager = poolManager_;
        builder = builder_;
    }

    /// @notice The fee a swap would pay right now, for a pool launched at `start`.
    function feeAt(uint256 start, uint256 nowTs) public pure returns (uint24) {
        if (nowTs <= start) return START_FEE; // review I-01: a time before the launch is the launch fee
        if (nowTs >= start + DECAY_SECONDS) return BASE_FEE;
        uint256 elapsed = nowTs - start;
        return uint24(START_FEE - ((uint256(START_FEE - BASE_FEE) * elapsed) / DECAY_SECONDS));
    }

    /// @notice The fee a swap in this pool pays right now.
    function currentFee(PoolKey calldata key) external view returns (uint24) {
        uint256 start = launchedAt[key.toId()];
        if (start == 0) return BASE_FEE;
        return feeAt(start, block.timestamp);
    }

    function beforeInitialize(address sender, PoolKey calldata key, uint160) external returns (bytes4) {
        if (msg.sender != poolManager) revert NotPoolManager();
        if (sender != builder) revert NotBuilder();
        launchedAt[key.toId()] = block.timestamp;
        return IHooks.beforeInitialize.selector;
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external
        view
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (msg.sender != poolManager) revert NotPoolManager();
        uint256 start = launchedAt[key.toId()];
        if (start == 0) revert NotAPadPool();
        uint24 fee = sender == builder ? BASE_FEE : feeAt(start, block.timestamp);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

}
