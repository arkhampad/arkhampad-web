// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";
import {PoolFlow} from "./PoolFlow.sol";
import {MockUSDC} from "./Mocks.sol";
import {PadCurve} from "../src/PadCurve.sol";

/// @notice Full flow against a fresh local Uniswap v4 deployment.
abstract contract PoolLocalBase is PoolFlow, DeployPermit2 {
    function _usdcAt() internal virtual returns (address);
    function _mock() internal virtual returns (string memory) { return "Mocks.sol:MockUSDC"; }

    function setUp() public {
        pm = IPoolManager(deployCode("out/PoolManager.sol/PoolManager.json", abi.encode(address(this))));
        permit2 = IAllowanceTransfer(deployPermit2());
        posm = IPositionManager(deployCode("out/PositionManager.sol/PositionManager.json", abi.encode(pm, permit2, uint256(300_000), IPositionDescriptor(address(0)), IWETH9(address(0)))));
        address at = _usdcAt();
        deployCodeTo(_mock(), at);
        usdc = IERC20(at);
        _deployPad();
    }

    function _fund(address who, uint256 amount) internal override {
        MockUSDC(address(usdc)).mint(who, amount);
    }

    function test_graduateTradeCollect() public { _flow_graduateTradeCollect(); }
    function test_buybackBurn() public { _flow_buybackBurn(); }
    function test_guardBlocksEarlyPool() public { _flow_guardBlocksEarlyPool(); }
    function test_gasless() public { _flow_gasless(); }
    function test_gaslessPool() public { _flow_gaslessPool(); }
    function test_poolNeedsGraduation() public { _flow_poolNeedsGraduation(); }
}

/// USDC sorts first (currency0) in every pool.
contract PoolLocalUsdcLowTest is PoolLocalBase {
    function _usdcAt() internal pure override returns (address) { return address(0x0000000000000000000000000000000000001000); }
    function test_order() public { vm.prank(creator); (address c,) = hub.createCoin("A", "A", "", 0, PadCurve.FeeMode.ToCreator, 0, 0); assertTrue(builder.usdcIsCurrency0(c)); }
}

/// USDC sorts last (currency1) in every pool.
contract PoolLocalUsdcHighTest is PoolLocalBase {
    function _usdcAt() internal pure override returns (address) { return address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF); }
    function test_order() public { vm.prank(creator); (address c,) = hub.createCoin("A", "A", "", 0, PadCurve.FeeMode.ToCreator, 0, 0); assertFalse(builder.usdcIsCurrency0(c)); }
}

/// BNB-style dollar (18 decimals, no permit), sorting first and last.
contract PoolLocalUsd18LowTest is PoolLocalBase {
    function _usdcAt() internal pure override returns (address) { return address(0x0000000000000000000000000000000000001000); }
    function _mock() internal pure override returns (string memory) { return "Mocks.sol:MockUSD18"; }
}
contract PoolLocalUsd18HighTest is PoolLocalBase {
    function _usdcAt() internal pure override returns (address) { return address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF); }
    function _mock() internal pure override returns (string memory) { return "Mocks.sol:MockUSD18"; }
}
