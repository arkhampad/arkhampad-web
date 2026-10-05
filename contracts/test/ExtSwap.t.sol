// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PadExtSwap} from "../src/PadExtSwap.sol";
import {MockUSDC} from "./Mocks.sol";

contract Coin is ERC20 {
    constructor() ERC20("Ext", "EXT") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
}

/// Coin that burns 10% on every transfer except mints.
contract FeeCoin is ERC20 {
    constructor() ERC20("Fee", "FEE") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
    function _update(address from, address to, uint256 v) internal override {
        if (from == address(0) || to == address(0)) return super._update(from, to, v);
        uint256 burn = v / 10;
        super._update(from, address(0), burn);
        super._update(from, to, v - burn);
    }
}

/// Fake aggregator: takes `amountIn` of tokenIn (or less, to test refunds) and sends `out` of tokenOut to `to`.
contract MockAgg {
    function swap(IERC20 tokenIn, uint256 amountIn, IERC20 tokenOut, uint256 out, address to) external {
        tokenIn.transferFrom(msg.sender, address(this), amountIn);
        tokenOut.transfer(to, out);
    }
}

contract ExtSwapTest is Test {
    PadExtSwap sw;
    MockUSDC usdc;
    Coin coin;
    MockAgg agg;
    address admin = address(0xA11CE);
    address treasury = address(0x7EA5);
    address relayer = address(0x5E1A);
    uint256 pk = 0xB0B;
    address user;

    function setUp() public {
        usdc = new MockUSDC();
        coin = new Coin();
        agg = new MockAgg();
        sw = new PadExtSwap(IERC20(address(usdc)), admin, treasury);
        vm.prank(admin);
        sw.setTarget(address(agg), true);
        user = vm.addr(pk);
        usdc.mint(user, 1_000e6);
        usdc.mint(address(agg), 1_000_000e6);
        coin.mint(address(agg), 1_000_000e18);
        vm.prank(user);
        usdc.approve(address(sw), type(uint256).max);
        vm.prank(user);
        coin.approve(address(sw), type(uint256).max);
    }

    function _sign(PadExtSwap.Swap memory s) internal view returns (PadExtSwap.Swap memory) {
        bytes32 h = keccak256(abi.encode(sw.EXT_SWAP_TYPEHASH(), s.user, s.isBuy, s.coin, s.amountIn, s.minOut, s.target, keccak256(s.data), s.fee, s.nonce, s.deadline));
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", sw.domainSeparator(), h)));
        s.signature = abi.encodePacked(r, ss, v);
        return s;
    }

    function _buy(uint256 usdcIn, uint256 takes, uint256 coinsOut, uint256 minOut, uint256 nonce, address to) internal view returns (PadExtSwap.Swap memory) {
        bytes memory data = abi.encodeCall(MockAgg.swap, (IERC20(address(usdc)), takes, IERC20(address(coin)), coinsOut, to));
        return _sign(PadExtSwap.Swap(user, true, address(coin), usdcIn, minOut, address(agg), data, 0.01e6, nonce, block.timestamp + 60, ""));
    }

    function test_buy_feesAndCoins() public {
        PadExtSwap.Swap memory s = _buy(100e6, 99e6, 5_000e18, 5_000e18, 1, address(sw));
        vm.prank(relayer);
        uint256 out = sw.swap(s);
        assertEq(out, 5_000e18);
        assertEq(coin.balanceOf(user), 5_000e18);
        assertEq(usdc.balanceOf(user), 1_000e6 - 100e6 - 0.01e6);
        assertEq(usdc.balanceOf(treasury), 1e6, "1% fee");
        assertEq(usdc.balanceOf(relayer), 0.01e6, "network fee");
        assertEq(usdc.balanceOf(address(sw)), 0);
        assertEq(coin.balanceOf(address(sw)), 0);
        assertEq(usdc.allowance(address(sw), address(agg)), 0, "approval reset");
    }

    function test_buy_refundsUnusedUsdc() public {
        PadExtSwap.Swap memory s = _buy(100e6, 60e6, 1_000e18, 1, 2, address(sw)); // aggregator only takes 60 of 99
        vm.prank(relayer);
        sw.swap(s);
        assertEq(usdc.balanceOf(user), 1_000e6 - 100e6 - 0.01e6 + 39e6);
        assertEq(usdc.balanceOf(address(sw)), 0);
    }

    function test_sell_feesAndUsdc() public {
        coin.mint(user, 2_000e18);
        bytes memory data = abi.encodeCall(MockAgg.swap, (IERC20(address(coin)), 2_000e18, IERC20(address(usdc)), 50e6, address(sw)));
        PadExtSwap.Swap memory s = _sign(PadExtSwap.Swap(user, false, address(coin), 2_000e18, 49e6, address(agg), data, 0.01e6, 3, block.timestamp + 60, ""));
        uint256 u0 = usdc.balanceOf(user);
        vm.prank(relayer);
        uint256 out = sw.swap(s);
        assertEq(out, 50e6 - 0.5e6 - 0.01e6);
        assertEq(usdc.balanceOf(user) - u0, out);
        assertEq(usdc.balanceOf(treasury), 0.5e6);
        assertEq(coin.balanceOf(user), 0);
        assertEq(coin.balanceOf(address(sw)), 0);
    }

    function test_rejects_wrongRecipient() public {
        // aggregator calldata that sends the coins somewhere else: nothing arrives -> slippage
        PadExtSwap.Swap memory s = _buy(100e6, 99e6, 5_000e18, 1, 4, address(0xBAD));
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(PadExtSwap.Slippage.selector, 0, 1));
        sw.swap(s);
    }

    function test_rejects_slippage_tamper_replay_target_expiry() public {
        PadExtSwap.Swap memory s = _buy(100e6, 99e6, 5_000e18, 5_001e18, 5, address(sw));
        vm.expectRevert(abi.encodeWithSelector(PadExtSwap.Slippage.selector, 5_000e18, 5_001e18));
        sw.swap(s);
        // tampered calldata (relayer swaps in its own route)
        s = _buy(100e6, 99e6, 5_000e18, 5_000e18, 6, address(sw));
        s.data = abi.encodeCall(MockAgg.swap, (IERC20(address(usdc)), 99e6, IERC20(address(coin)), 1e18, address(sw)));
        vm.expectRevert(PadExtSwap.BadSignature.selector);
        sw.swap(s);
        // replay
        s = _buy(10e6, 9.9e6, 500e18, 1, 7, address(sw));
        sw.swap(s);
        vm.expectRevert(PadExtSwap.NonceAlreadyUsed.selector);
        sw.swap(s);
        // target not on the list
        s = _buy(10e6, 9.9e6, 500e18, 1, 8, address(sw));
        vm.prank(admin);
        sw.setTarget(address(agg), false);
        vm.expectRevert(PadExtSwap.TargetNotAllowed.selector);
        sw.swap(s);
        vm.prank(admin);
        sw.setTarget(address(agg), true);
        // expired
        vm.warp(block.timestamp + 61);
        vm.expectRevert(PadExtSwap.Expired.selector);
        sw.swap(s);
    }

    function test_onlyAdmin() public {
        vm.expectRevert(PadExtSwap.NotAdmin.selector);
        sw.setTarget(address(1), true);
        vm.expectRevert(PadExtSwap.NotAdmin.selector);
        sw.setTreasury(address(1));
    }

    function test_cannotUseUsdcOrTargetAsCoin() public {
        PadExtSwap.Swap memory s = _buy(10e6, 9.9e6, 500e18, 1, 9, address(sw));
        s.coin = address(usdc);
        s = _sign(s);
        vm.expectRevert(PadExtSwap.BadCoin.selector);
        sw.swap(s);
    }

    /// minOut protects what the user actually receives, also for fee-on-transfer coins
    function test_buy_feeOnTransfer_minOutIsUserReceived() public {
        FeeCoin fc = new FeeCoin();
        fc.mint(address(agg), 1_000_000e18);
        // aggregator sends 1,000 -> swap gets 900 -> user gets 810
        bytes memory data = abi.encodeCall(MockAgg.swap, (IERC20(address(usdc)), 99e6, IERC20(address(fc)), 1_000e18, address(sw)));
        PadExtSwap.Swap memory bad = _sign(PadExtSwap.Swap(user, true, address(fc), 100e6, 900e18, address(agg), data, 0.01e6, 41, block.timestamp + 60, ""));
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(PadExtSwap.Slippage.selector, 810e18, 900e18));
        sw.swap(bad);
        PadExtSwap.Swap memory ok = _sign(PadExtSwap.Swap(user, true, address(fc), 100e6, 810e18, address(agg), data, 0.01e6, 42, block.timestamp + 60, ""));
        vm.prank(relayer);
        uint256 out = sw.swap(ok);
        assertEq(out, 810e18, "returns what the user received");
        assertEq(fc.balanceOf(user), 810e18);
        assertEq(fc.balanceOf(address(sw)), 0);
    }
}
