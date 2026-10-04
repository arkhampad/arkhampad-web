// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PadExtSwap} from "../src/PadExtSwap.sol";

interface ISwapRouter02 {
    struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }
    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256);
}

/// Real Base mainnet: buy and sell WETH through the real Uniswap router with real USDC,
/// gasless (the user has no ETH), with the 1% fee to the treasury.
/// Name starts with BaseMainnetForkTest so the CI fork step picks it up.
contract BaseMainnetForkTestExtSwap is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481; // Uniswap SwapRouter02
    bool on;
    PadExtSwap sw;
    uint256 pk;
    address user;
    address treasury = address(0x7EA5);
    address relayer = address(0x5E1A);

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC", string(""));
        if (bytes(rpc).length == 0) { require(!vm.envOr("CI", false), "missing secret BASE_RPC"); return; }
        vm.createSelectFork(rpc);
        on = true;
        sw = new PadExtSwap(IERC20(USDC), address(this), treasury);
        sw.setTarget(ROUTER, true);
        pk = uint256(keccak256(abi.encode("arkhampad ext swap", block.chainid)));
        user = vm.addr(pk);
        deal(USDC, user, 500e6);
        vm.prank(user);
        IERC20(USDC).approve(address(sw), type(uint256).max);
        vm.prank(user);
        IERC20(WETH).approve(address(sw), type(uint256).max);
        console2.log("forked chain", block.chainid, "at block", block.number);
    }

    function _signed(PadExtSwap.Swap memory s) internal view returns (PadExtSwap.Swap memory) {
        bytes32 h = keccak256(abi.encode(sw.EXT_SWAP_TYPEHASH(), s.user, s.isBuy, s.coin, s.amountIn, s.minOut, s.target, keccak256(s.data), s.fee, s.nonce, s.deadline));
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", sw.domainSeparator(), h)));
        s.signature = abi.encodePacked(r, ss, v);
        return s;
    }

    function test_buyAndSellRealPool() public {
        if (!on) return;
        // buy: $100 -> 1% fee -> $99 swapped for WETH, delivered to the contract then the user
        bytes memory data = abi.encodeCall(ISwapRouter02.exactInputSingle, (ISwapRouter02.ExactInputSingleParams(USDC, WETH, 500, address(sw), 99e6, 0, 0)));
        PadExtSwap.Swap memory s = _signed(PadExtSwap.Swap(user, true, WETH, 100e6, 1, ROUTER, data, 0.01e6, 1, block.timestamp + 120, ""));
        vm.prank(relayer);
        uint256 weth = sw.swap(s);
        assertGt(weth, 0);
        assertEq(IERC20(WETH).balanceOf(user), weth);
        assertEq(IERC20(USDC).balanceOf(treasury), 1e6);
        assertEq(IERC20(USDC).balanceOf(relayer), 0.01e6);
        assertEq(user.balance, 0, "user never needed ETH");
        console2.log("bought WETH (wei)", weth);

        // sell it all back
        bytes memory data2 = abi.encodeCall(ISwapRouter02.exactInputSingle, (ISwapRouter02.ExactInputSingleParams(WETH, USDC, 500, address(sw), weth, 0, 0)));
        uint256 u0 = IERC20(USDC).balanceOf(user);
        s = _signed(PadExtSwap.Swap(user, false, WETH, weth, 90e6, ROUTER, data2, 0.01e6, 2, block.timestamp + 120, ""));
        vm.prank(relayer);
        uint256 back = sw.swap(s);
        assertEq(IERC20(USDC).balanceOf(user) - u0, back);
        assertGt(back, 96e6, "round trip keeps ~98% (1% fee each way + pool fee)");
        assertEq(IERC20(WETH).balanceOf(address(sw)), 0);
        assertEq(IERC20(USDC).balanceOf(address(sw)), 0);
        console2.log("sold back for USDC", back);
    }
}
