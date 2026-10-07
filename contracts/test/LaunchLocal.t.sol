// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {DeployPermit2} from "permit2/test/utils/DeployPermit2.sol";
import {LaunchFlow} from "./LaunchFlow.sol";
import {MockUSDC} from "./Mocks.sol";
import {FeeMode} from "../src/PadTypes.sol";

/// @notice The full launch flow against a fresh local Uniswap v4 deployment.
abstract contract LaunchLocalBase is LaunchFlow, DeployPermit2 {
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

    function test_launchOpensPool() public { _flow_launchOpensPool(); }
    function test_feeSchedule() public { _flow_feeSchedule(); }
    function test_sniperFeesSplit() public { _flow_sniperFeesSplit(); }
    function test_outsideTradesPayUs() public { _flow_outsideTradesPayUs(); }
    function test_launchBuyPaysBase() public { _flow_launchBuyPaysBase(); }
    function test_sellBackAll() public { _flow_sellBackAll(); }
    function test_buybackBurn() public { _flow_buybackBurn(); }
    function test_guardBlocksOtherPools() public { _flow_guardBlocksOtherPools(); }
    function test_gasless() public { _flow_gasless(); }
    function test_onlyOurCoins() public { _flow_onlyOurCoins(); }
    function test_minLaunchBuy() public { _flow_minLaunchBuy(); }
    function test_hardening() public { _flow_hardening(); }
    function test_callbacksLocked() public { _flow_callbacksLocked(); }
    function test_pause() public { _flow_pause(); }
    function test_creatorLock() public { _flow_creatorLock(); }
    function test_builderStrayUsdc() public { _flow_builderStrayUsdc(); }
    function test_routerSweep() public { _flow_routerSweep(); }

    /// Any buy size from $1 to $50K at any moment in the launch window: never reverts,
    /// and the buyer can always sell everything back.
    function testFuzz_buySell(uint64 usdcRaw, uint16 secondsIn) public {
        uint256 amount = bound(uint256(usdcRaw), D, 50_000 * D);
        _fund(alice, amount);
        address coin = address(_launchCoin());
        vm.warp(vm.getBlockTimestamp() + bound(uint256(secondsIn), 0, 900));
        uint256 got = _extBuy(alice, coin, amount);
        assertGt(got, 0);
        uint256 back = _extSell(alice, coin, got);
        assertGt(back, 0);
        assertLe(back, amount, "no free money");
    }

    function _launchCoin() internal returns (address) {
        _fund(creator, 5 * D);
        vm.startPrank(creator);
        usdc.approve(address(hub), 5 * D);
        address c = hub.createCoin("Fuzz", "FUZZ", "", 0, FeeMode.ToCreator, 5 * D, 0);
        vm.stopPrank();
        return c;
    }
}

/// USDC sorts first (currency0) in every pool.
contract LaunchLocalUsdcLowTest is LaunchLocalBase {
    function _usdcAt() internal pure override returns (address) { return address(0x0000000000000000000000000000000000001000); }
    function test_order() public { assertTrue(builder.usdcIsCurrency0(_launchCoin())); }
}

/// USDC sorts last (currency1) in every pool.
contract LaunchLocalUsdcHighTest is LaunchLocalBase {
    function _usdcAt() internal pure override returns (address) { return address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF); }
    function test_order() public { assertFalse(builder.usdcIsCurrency0(_launchCoin())); }
}

/// BNB-style dollar (18 decimals, no permit), sorting first and last.
contract LaunchLocalUsd18LowTest is LaunchLocalBase {
    function _usdcAt() internal pure override returns (address) { return address(0x0000000000000000000000000000000000001000); }
    function _mock() internal pure override returns (string memory) { return "Mocks.sol:MockUSD18"; }
}

contract LaunchLocalUsd18HighTest is LaunchLocalBase {
    function _usdcAt() internal pure override returns (address) { return address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF); }
    function _mock() internal pure override returns (string memory) { return "Mocks.sol:MockUSD18"; }
}
