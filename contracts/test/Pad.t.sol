// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PadHub} from "../src/PadHub.sol";
import {PadCurve} from "../src/PadCurve.sol";
import {PadCoin} from "../src/PadCoin.sol";
import {PadPromote} from "../src/PadPromote.sol";
import {MockUSDC, MockPoolBuilder} from "./Mocks.sol";

contract PadTest is Test {
    MockUSDC usdc;
    MockPoolBuilder builder;
    PadHub hub;
    address admin = address(0xA11CE);
    address treasury = address(0x7EA5);
    address creator = address(0xC0DE);
    address alice = address(0xA1);
    address bob = address(0xB0B);

    uint256 constant FOR_SALE = 225403330717033245926072205;
    uint256 constant RESERVED = 774596669282966754073927795;

    function setUp() public {
        usdc = new MockUSDC();
        builder = new MockPoolBuilder(IERC20(address(usdc)));
        hub = new PadHub(
            IERC20(address(usdc)),
            builder,
            PadHub.CurveParams({vUsdc: 4500e6, vCoin: 1e27, coinsForSale: FOR_SALE, coinsReserved: RESERVED}),
            admin,
            treasury
        );
        for (uint160 i = 1; i < 6; i++) {}
        usdc.mint(creator, 1_000_000e6);
        usdc.mint(alice, 1_000_000e6);
        usdc.mint(bob, 1_000_000e6);
    }

    function _create(uint256 lock, PadCurve.FeeMode mode, uint256 launch) internal returns (PadCoin coin, PadCurve curve) {
        vm.startPrank(creator);
        usdc.approve(address(hub), launch);
        (address c, address cv) = hub.createCoin("Moonfrog", "MFROG", "ipfs://meta", lock, mode, launch, 0);
        vm.stopPrank();
        coin = PadCoin(c);
        curve = PadCurve(cv);
    }

    function _buy(address who, PadCurve curve, uint256 amt) internal returns (uint256 out) {
        vm.startPrank(who);
        usdc.approve(address(curve), amt);
        out = curve.buy(amt, 0, who);
        vm.stopPrank();
    }

    function _sell(address who, PadCurve curve, uint256 amt) internal returns (uint256 out) {
        vm.startPrank(who);
        IERC20(address(curve.coin())).approve(address(curve), amt);
        out = curve.sell(amt, 0, who);
        vm.stopPrank();
    }

    // ------------------------------------------------------------- creation

    function test_createFree() public {
        uint256 before = usdc.balanceOf(creator);
        (PadCoin coin, PadCurve curve) = _create(0, PadCurve.FeeMode.ToCreator, 0);
        assertEq(usdc.balanceOf(creator), before, "launch must be free");
        assertEq(coin.totalSupply(), 1e27);
        assertEq(coin.balanceOf(address(curve)), 1e27);
        assertEq(hub.curveOf(address(coin)), address(curve));
        assertEq(hub.coinCount(), 1);
        assertApproxEqAbs(curve.marketCap(), 4500e6, 1);
        assertEq(coin.name(), "Moonfrog");
        assertEq(coin.metadataURI(), "ipfs://meta");
    }

    function test_badNames() public {
        vm.prank(creator);
        vm.expectRevert(PadHub.BadName.selector);
        hub.createCoin("", "X", "", 0, PadCurve.FeeMode.ToCreator, 0, 0);
        vm.prank(creator);
        vm.expectRevert(PadHub.BadName.selector);
        hub.createCoin("Name", "ABCDEFGHIJK", "", 0, PadCurve.FeeMode.ToCreator, 0, 0);
    }

    function test_launchBuyFullFeeToPlatform() public {
        (PadCoin coin, PadCurve curve) = _create(0, PadCurve.FeeMode.ToCreator, 50e6);
        assertGt(coin.balanceOf(creator), 0);
        assertEq(curve.creatorFees(), 0, "creator gets nothing from own launch buy");
        // 50 USDC in total: net = 50/1.01, fee ~ 0.495
        assertApproxEqAbs(curve.platformFees(), 495049, 2);
        assertEq(usdc.balanceOf(address(curve)), 50e6 - 1 + 1, "all 50 pulled");
    }

    function test_launchBuyOnlyOnce() public {
        (, PadCurve curve) = _create(0, PadCurve.FeeMode.ToCreator, 0);
        vm.prank(address(hub));
        usdc.mint(address(hub), 10e6);
        vm.startPrank(address(hub));
        usdc.approve(address(curve), 10e6);
        curve.launchBuy(5e6, 0, creator);
        vm.expectRevert(PadCurve.OnlyHub.selector);
        curve.launchBuy(5e6, 0, creator);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(PadCurve.OnlyHub.selector);
        curve.launchBuy(5e6, 0, alice);
    }

    // ------------------------------------------------------------- trading

    function test_buyFeeSplit() public {
        (, PadCurve curve) = _create(0, PadCurve.FeeMode.ToCreator, 0);
        _buy(alice, curve, 101e6); // net 100, fee 1
        assertEq(curve.usdcReserve(), 100e6);
        assertEq(curve.creatorFees(), 0.3e6);
        assertEq(curve.platformFees(), 0.7e6);
    }

    function test_sellFeeSplitAndPrice() public {
        (PadCoin coin, PadCurve curve) = _create(0, PadCurve.FeeMode.ToCreator, 0);
        uint256 got = _buy(alice, curve, 101e6);
        uint256 balBefore = usdc.balanceOf(alice);
        uint256 out = _sell(alice, curve, got);
        assertEq(coin.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(alice) - balBefore, out);
        // round trip loses ~2% to fees, never gains
        assertLt(out, 100e6);
        assertApproxEqRel(out, 99e6, 0.001e18);
        assertLe(curve.usdcReserve(), 1, "reserve back to ~0");
    }

    function test_slippage() public {
        (, PadCurve curve) = _create(0, PadCurve.FeeMode.ToCreator, 0);
        uint256 q = curve.quoteBuy(10e6);
        vm.startPrank(alice);
        usdc.approve(address(curve), 10e6);
        vm.expectRevert();
        curve.buy(10e6, q + 1, alice);
        uint256 got = curve.buy(10e6, q, alice);
        assertEq(got, q);
        vm.stopPrank();
    }

    function test_quoteSellMatches() public {
        (, PadCurve curve) = _create(0, PadCurve.FeeMode.ToCreator, 0);
        uint256 got = _buy(alice, curve, 200e6);
        uint256 q = curve.quoteSell(got / 2);
        assertEq(_sell(alice, curve, got / 2), q);
    }

    function test_pauseStopsBuysNotSells() public {
        (, PadCurve curve) = _create(0, PadCurve.FeeMode.ToCreator, 0);
        uint256 got = _buy(alice, curve, 50e6);
        vm.prank(admin);
        hub.setGuardian(bob);
        vm.prank(bob);
        hub.pauseBuys();
        vm.startPrank(alice);
        usdc.approve(address(curve), 10e6);
        vm.expectRevert(PadCurve.BuysPaused.selector);
        curve.buy(10e6, 0, alice);
        vm.stopPrank();
        _sell(alice, curve, got); // still works
        vm.prank(bob);
        vm.expectRevert(PadHub.NotAdmin.selector);
        hub.unpauseBuys();
        vm.prank(admin);
        hub.unpauseBuys();
        _buy(alice, curve, 10e6);
    }

    // ------------------------------------------------------------- lock

    function test_creatorLock() public {
        (PadCoin coin, PadCurve curve) = _create(1 days, PadCurve.FeeMode.ToCreator, 20e6);
        uint256 bal = coin.balanceOf(creator);
        assertTrue(coin.isLocked());
        vm.startPrank(creator);
        coin.approve(address(curve), bal);
        vm.expectRevert(abi.encodeWithSelector(PadCoin.CreatorLocked.selector, coin.unlockTime()));
        curve.sell(bal, 0, creator);
        vm.expectRevert();
        coin.transfer(alice, 1);
        vm.stopPrank();
        // creator can still buy more while locked
        _buy(creator, curve, 5e6);
        vm.warp(block.timestamp + 1 days);
        assertFalse(coin.isLocked());
        _sell(creator, curve, coin.balanceOf(creator));
    }

    function test_lockTooLong() public {
        vm.prank(creator);
        vm.expectRevert(PadCoin.LockTooLong.selector);
        hub.createCoin("A", "A", "", 2 days, PadCurve.FeeMode.ToCreator, 0, 0);
    }

    // ------------------------------------------------------------- graduation

    function test_fillAndGraduate() public {
        (PadCoin coin, PadCurve curve) = _create(0, PadCurve.FeeMode.ToCreator, 0);
        // buy far more than needed: only what is needed is pulled
        uint256 before = usdc.balanceOf(alice);
        _buy(alice, curve, 5000e6);
        uint256 spent = before - usdc.balanceOf(alice);
        assertEq(uint256(curve.phase()), uint256(PadCurve.Phase.Full));
        assertEq(curve.coinsForSale(), 0);
        assertApproxEqRel(curve.marketCap(), 7500e6, 0.0001e18, "graduates at $7.5K");
        assertApproxEqAbs(curve.usdcReserve(), 1309475019, 2);
        assertApproxEqAbs(spent, 1309475019 + 13094751, 3, "net + 1% fee");

        vm.startPrank(bob);
        usdc.approve(address(curve), 10e6);
        vm.expectRevert(PadCurve.NotOpen.selector);
        curve.buy(10e6, 0, bob);
        vm.stopPrank();

        uint256 reserve = curve.usdcReserve();
        uint256 platBefore = curve.platformFees();
        vm.prank(bob); // anyone
        curve.graduate();
        uint256 gradFee = reserve * 200 / 10_000;
        assertEq(curve.platformFees() - platBefore, gradFee, "2% graduation fee");
        assertEq(builder.lastUsdc(), reserve - gradFee);
        assertEq(usdc.balanceOf(address(builder)), reserve - gradFee);
        assertEq(coin.balanceOf(address(builder)), builder.lastCoins());
        // pool price equals final curve price
        uint256 poolPrice = builder.lastUsdc() * 1e18 / builder.lastCoins();
        uint256 curvePrice = curve.vUsdc() * 1e18 / curve.vCoin();
        assertApproxEqRel(poolPrice, curvePrice, 0.000001e18);
        // everything else burned; curve holds no coins
        assertEq(coin.balanceOf(address(curve)), 0);
        assertEq(coin.balanceOf(curve.BURN()) + coin.balanceOf(address(builder)) + coin.balanceOf(alice), 1e27);
        // curve keeps exactly the fees
        assertEq(usdc.balanceOf(address(curve)), curve.platformFees() + curve.creatorFees());

        vm.expectRevert(PadCurve.AlreadyGraduated.selector);
        curve.graduate();
    }

    function test_cannotGraduateEarly() public {
        (, PadCurve curve) = _create(0, PadCurve.FeeMode.ToCreator, 0);
        _buy(alice, curve, 100e6);
        vm.expectRevert(PadCurve.NotFull.selector);
        curve.graduate();
    }

    function test_noSellWhenFull() public {
        (, PadCurve curve) = _create(0, PadCurve.FeeMode.ToCreator, 0);
        uint256 got = _buy(alice, curve, 5000e6);
        vm.startPrank(alice);
        IERC20(address(curve.coin())).approve(address(curve), got);
        vm.expectRevert(PadCurve.NotOpen.selector);
        curve.sell(got, 0, alice);
        vm.stopPrank();
    }

    // ------------------------------------------------------------- fees

    function test_feesToCreatorAndTreasury() public {
        (, PadCurve curve) = _create(0, PadCurve.FeeMode.ToCreator, 0);
        _buy(alice, curve, 1010e6);
        uint256 c0 = usdc.balanceOf(creator);
        vm.prank(bob);
        curve.settleCreatorFees();
        assertEq(usdc.balanceOf(creator) - c0, 3e6);
        vm.prank(bob);
        curve.claimPlatformFees();
        assertEq(usdc.balanceOf(treasury), 7e6);
        vm.prank(admin);
        hub.setTreasury(address(0xBEEF));
        _buy(alice, curve, 101e6);
        curve.claimPlatformFees();
        assertEq(usdc.balanceOf(address(0xBEEF)), 0.7e6);
    }

    function test_buybackOnCurveBurns() public {
        (PadCoin coin, PadCurve curve) = _create(0, PadCurve.FeeMode.BuybackBurn, 0);
        _buy(alice, curve, 1010e6);
        assertEq(curve.creatorFees(), 3e6);
        uint256 burnBefore = coin.balanceOf(curve.BURN());
        uint256 c0 = usdc.balanceOf(creator);
        uint256 used = curve.settleCreatorFees();
        assertGt(used, 0);
        assertGt(coin.balanceOf(curve.BURN()), burnBefore, "coins burned");
        assertEq(usdc.balanceOf(creator), c0, "creator not paid in burn mode");
        // solvency: alice can still sell everything
        _sell(alice, curve, coin.balanceOf(alice));
    }

    function test_buybackAfterGraduationGoesToPool() public {
        (, PadCurve curve) = _create(0, PadCurve.FeeMode.BuybackBurn, 0);
        _buy(alice, curve, 5000e6);
        curve.graduate();
        uint256 have = curve.creatorFees();
        assertGt(have, 0);
        curve.settleCreatorFees();
        assertEq(builder.buybackFunds(), have);
        assertEq(curve.creatorFees(), 0);
    }

    // ------------------------------------------------------------- invariants

    function testFuzz_solvency(uint256[8] memory amts, uint8 sellMask) public {
        (PadCoin coin, PadCurve curve) = _create(0, PadCurve.FeeMode.BuybackBurn, 0);
        for (uint256 i; i < 8; i++) {
            uint256 a = bound(amts[i], 1e4, 400e6);
            if (uint256(curve.phase()) != 0) break;
            address who = i % 2 == 0 ? alice : bob;
            _buy(who, curve, a);
            if ((sellMask >> i) & 1 == 1 && uint256(curve.phase()) == 0) {
                uint256 b = coin.balanceOf(who) / 3;
                if (b > 0) _sell(who, curve, b);
            }
            if (i % 3 == 0 && uint256(curve.phase()) == 0) curve.settleCreatorFees();
        }
        // the curve always holds reserve + fees
        assertGe(usdc.balanceOf(address(curve)), curve.usdcReserve() + curve.creatorFees() + curve.platformFees());
        if (uint256(curve.phase()) == 0) {
            // everyone can exit
            uint256 a = coin.balanceOf(alice);
            if (a > 0) _sell(alice, curve, a);
            uint256 b = coin.balanceOf(bob);
            if (b > 0) _sell(bob, curve, b);
            assertGe(usdc.balanceOf(address(curve)), curve.creatorFees() + curve.platformFees());
        }
    }

    // ------------------------------------------------------------- admin

    function test_adminTransfer() public {
        vm.prank(alice);
        vm.expectRevert(PadHub.NotAdmin.selector);
        hub.setTreasury(alice);
        vm.prank(admin);
        hub.proposeAdmin(bob);
        vm.prank(alice);
        vm.expectRevert(PadHub.NotAllowed.selector);
        hub.acceptAdmin();
        vm.prank(bob);
        hub.acceptAdmin();
        assertEq(hub.admin(), bob);
    }

    // ------------------------------------------------------------- promote

    function test_promote() public {
        PadPromote p = new PadPromote(IERC20(address(usdc)), admin, treasury);
        vm.startPrank(alice);
        usdc.approve(address(p), 20e6);
        p.promote(address(0x1234), 8453, 2);
        vm.stopPrank();
        assertEq(usdc.balanceOf(treasury), 20e6);
        vm.expectRevert(PadPromote.NoSuchPlan.selector);
        p.promote(address(0x1234), 8453, 9);
        vm.prank(alice);
        vm.expectRevert(PadPromote.NotAdmin.selector);
        p.setPlan(1, 1, 1, true);
        vm.prank(admin);
        p.setPlan(1, 6 hours, 12e6, true);
        (, uint128 price,) = p.plans(1);
        assertEq(price, 12e6);
    }
}
