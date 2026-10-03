// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @title PadInitGuard
/// @notice Uniswap v4 hook used by every graduated ArkhamPad pool. Its only
/// job: nobody except the pool builder can create (initialize) a pool with
/// this hook, so no one can open a graduating coin's pool early at a bad price.
/// It has no other permissions and never touches swaps or liquidity.
/// Deployed with CREATE2 so its address carries only the before-initialize flag.
contract PadInitGuard {
    address public immutable poolManager;
    address public immutable builder;

    error NotPoolManager();
    error NotBuilder();

    constructor(address poolManager_, address builder_) {
        poolManager = poolManager_;
        builder = builder_;
    }

    function beforeInitialize(address sender, PoolKey calldata, uint160) external view returns (bytes4) {
        if (msg.sender != poolManager) revert NotPoolManager();
        if (sender != builder) revert NotBuilder();
        return PadInitGuard.beforeInitialize.selector;
    }
}
