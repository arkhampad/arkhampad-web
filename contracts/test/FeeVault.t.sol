// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PadFeeVault} from "../src/PadFeeVault.sol";

contract USD is ERC20 {
    constructor() ERC20("USD", "USD") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract FeeVaultTest is Test {
    USD usd;
    USD coin;
    PadFeeVault vault;
    address owner = address(0xA11CE);
    address payer = address(0xBEEF);
    address user = address(0xCAFE);

    function setUp() public {
        vm.warp(1_800_000_000);
        usd = new USD();
        coin = new USD();
        vault = new PadFeeVault(IERC20(address(usd)), owner, payer, 500e6);
        usd.mint(address(vault), 10_000e6);
        coin.mint(address(vault), 1e18);
    }

    function test_payerPaysReferralsWithinDailyCap() public {
        vm.startPrank(payer);
        vault.payReferral(user, 300e6, bytes32("a"));
        vault.payReferral(user, 200e6, bytes32("b"));
        vm.expectRevert(abi.encodeWithSelector(PadFeeVault.OverDailyCap.selector, 1, 0));
        vault.payReferral(user, 1, bytes32("c"));
        vm.stopPrank();
        assertEq(usd.balanceOf(user), 500e6);
        assertEq(vault.leftToday(), 0);
        // next day the limit resets
        vm.warp(block.timestamp + 1 days);
        assertEq(vault.leftToday(), 500e6);
        vm.prank(payer);
        vault.payReferral(user, 100e6, bytes32("d"));
        assertEq(usd.balanceOf(user), 600e6);
    }

    function test_onlyPayerCanPay_onlyOwnerCanWithdraw() public {
        vm.expectRevert(PadFeeVault.NotPayer.selector);
        vm.prank(user);
        vault.payReferral(user, 1e6, bytes32(0));
        vm.expectRevert(PadFeeVault.NotOwner.selector);
        vm.prank(payer);
        vault.withdraw(IERC20(address(usd)), payer, 1e6);
        vm.expectRevert(PadFeeVault.NotOwner.selector);
        vm.prank(payer);
        vault.setDailyCap(type(uint256).max);
    }

    function test_ownerWithdrawsAnyTokenAnyAmount() public {
        vm.startPrank(owner);
        vault.withdraw(IERC20(address(usd)), owner, 10_000e6);
        vault.withdraw(IERC20(address(coin)), owner, 1e18);
        vm.stopPrank();
        assertEq(usd.balanceOf(owner), 10_000e6);
        assertEq(coin.balanceOf(owner), 1e18);
    }

    function test_ownerControlsPayerAndCap_twoStepOwnership() public {
        vm.startPrank(owner);
        vault.setPayer(address(0));
        vault.setDailyCap(50e6);
        vault.proposeOwner(user);
        vm.stopPrank();
        vm.expectRevert(PadFeeVault.NotPayer.selector);
        vm.prank(payer);
        vault.payReferral(user, 1e6, bytes32(0));
        vm.expectRevert(PadFeeVault.NotOwner.selector);
        vm.prank(payer);
        vault.acceptOwner();
        vm.prank(user);
        vault.acceptOwner();
        assertEq(vault.owner(), user);
        assertEq(vault.dailyCap(), 50e6);
    }

    function testFuzz_neverPaysMoreThanCapPerDay(uint96 a, uint96 b) public {
        vm.startPrank(payer);
        uint256 paid;
        try vault.payReferral(user, a, bytes32("x")) { paid += a; } catch {}
        try vault.payReferral(user, b, bytes32("y")) { paid += b; } catch {}
        // zero amounts are rejected (no empty payout records)
        vm.stopPrank();
        assertLe(paid, 500e6);
        assertEq(usd.balanceOf(user), paid);
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(PadFeeVault.ZeroAddress.selector);
        new PadFeeVault(IERC20(address(usd)), owner, address(0), 500e6);
        vm.expectRevert(PadFeeVault.ZeroAddress.selector);
        new PadFeeVault(IERC20(address(usd)), address(0), payer, 500e6);
    }

    function test_zeroAmountsRejected() public {
        vm.expectRevert(PadFeeVault.ZeroAmount.selector);
        vm.prank(payer);
        vault.payReferral(user, 0, bytes32(0));
        vm.expectRevert(PadFeeVault.ZeroAmount.selector);
        vm.prank(owner);
        vault.withdraw(IERC20(address(usd)), owner, 0);
    }
}
