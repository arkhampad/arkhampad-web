// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ArkhamV3LauncherV2} from "../src/ArkhamV3LauncherV2.sol";
import {IV3PositionManager, IWrappedNative} from "../src/ArkhamV3Launcher.sol";
import {ArkhamPadCoin} from "../src/ArkhamPadCoin.sol";
import {MockWrapped, ISwapRouter, INpmView} from "./ArkhamV3Launcher.t.sol";

/// A creator that refuses plain native transfers (must get WHYPE instead, never block the coin).
contract NoNative {
    receive() external payable {
        revert("no");
    }
}

interface IFactoryCreate {
    function createPool(address, address, uint24) external returns (address);
}

interface IPoolInit {
    function initialize(uint160) external;
}

/// A creator contract that answers every native payment with a huge revert (a "return bomb").
contract Bomber {
    receive() external payable {
        uint256 w = 30_000;
        assembly {
            revert(0, mul(w, 32))
        }
    }
}

/// A creator contract that burns all the gas it is given when paid.
contract GasBurner {
    receive() external payable {
        while (true) {}
    }
}

/// A creator contract that tries to pump its coin from inside the keeper's check, when it gets paid,
/// so the check sees a market cap that isn't real (found by the independent review).
contract Pumper {
    address router;
    address whype;
    address coin;
    uint256 public pumpAmt;
    uint256 public got;
    uint256 public pumps;

    constructor(address r, address w) payable {
        router = r;
        whype = w;
    }

    function arm(address c, uint256 amt) external {
        coin = c;
        pumpAmt = amt;
    }

    receive() external payable {
        if (msg.sender == whype || pumpAmt == 0) return;
        uint256 a = pumpAmt;
        pumpAmt = 0;
        (bool ok,) = whype.call{value: a}(abi.encodeWithSignature("deposit()"));
        require(ok);
        IERC20(whype).approve(router, a);
        got = ISwapRouter(router).exactInputSingle(
            ISwapRouter.ExactInputSingleParams(whype, coin, 10_000, address(this), block.timestamp, a, 0, 0)
        );
        pumps++;
    }

    function unwind() external {
        uint256 g = got;
        if (g == 0) return;
        got = 0;
        IERC20(coin).approve(router, g);
        ISwapRouter(router).exactInputSingle(
            ISwapRouter.ExactInputSingleParams(coin, whype, 10_000, address(this), block.timestamp, g, 0, 0)
        );
    }
}

/// Tries to fake an hour above the line in one transaction: buy, poke, sell.
contract Faker {
    function run(ArkhamV3LauncherV2 l, address coin) external {
        l.poke(coin);
    }
}

contract ArkhamV3LauncherV2Test is Test {
    address owner = address(0xA11CE);
    address treasury = address(0x7EA5);
    address creator = address(0xC0FFEE);
    address trader = address(0xBEEF);
    address keeper = address(0x4EE9);

    MockWrapped whype;
    address factory;
    address npm;
    address router;
    ArkhamV3LauncherV2 launcher;

    uint256 constant START_MC = 100 ether; // 100 HYPE for the whole supply
    uint256 constant L1 = 400 ether; // "$25K"
    uint256 constant L2 = 1_600 ether; // "$100K"

    function _setUp(address whypeAt) internal {
        deployCodeTo("ArkhamV3Launcher.t.sol:MockWrapped", whypeAt);
        whype = MockWrapped(payable(whypeAt));
        factory = deployCode("v3/UniswapV3Factory.json");
        npm = deployCode("v3/NonfungiblePositionManager.json", abi.encode(factory, whypeAt, address(0)));
        router = deployCode("v3/SwapRouter.json", abi.encode(factory, whypeAt));
        launcher = new ArkhamV3LauncherV2(
            owner, IV3PositionManager(npm), IWrappedNative(whypeAt), 10_000, 200, treasury, START_MC, L1, L2, keeper
        );
        vm.deal(creator, 100_000 ether);
        vm.deal(trader, 100_000 ether);
        vm.warp(1_800_000_000);
    }

    function setUp() public virtual {
        _setUp(address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF));
    }

    // ------------------------------------------------ helpers

    function _launch(uint256 firstBuy) internal returns (address coin, uint256 bought) {
        vm.prank(creator);
        (coin, bought) = launcher.launch{value: firstBuy}("Elysium Cat", "ECAT", "https://arkhampad.com/s/x", address(0), 0);
    }

    function _buy(address coin, uint256 amount) internal returns (uint256 out) {
        vm.startPrank(trader);
        whype.deposit{value: amount}();
        whype.approve(router, amount);
        out = ISwapRouter(router).exactInputSingle(
            ISwapRouter.ExactInputSingleParams(address(whype), coin, 10_000, trader, block.timestamp, amount, 0, 0)
        );
        vm.stopPrank();
    }

    function _sell(address coin, uint256 amount) internal returns (uint256 out) {
        vm.startPrank(trader);
        IERC20(coin).approve(router, amount);
        out = ISwapRouter(router).exactInputSingle(
            ISwapRouter.ExactInputSingleParams(coin, address(whype), 10_000, trader, block.timestamp, amount, 0, 0)
        );
        vm.stopPrank();
    }

    /// Buys until the market cap is at least `mc` (small steps, so it lands just above).
    function _pumpTo(address coin, uint256 mc) internal {
        for (uint256 i; i < 400 && launcher.marketCap(coin) < mc; ++i) _buy(coin, 5 ether);
        assertGe(launcher.marketCap(coin), mc, "pump");
    }

    /// Sells until the market cap is below `mc`.
    function _dumpBelow(address coin, uint256 mc) internal {
        for (uint256 i; i < 400 && launcher.marketCap(coin) >= mc; ++i) {
            uint256 bal = IERC20(coin).balanceOf(trader);
            _sell(coin, bal / 10 + 1);
        }
        assertLt(launcher.marketCap(coin), mc, "dump");
    }

    /// Moves time forward. (block.timestamp can read stale inside one test function under via-ir.)
    function _skip(uint256 secs) internal {
        vm.warp(vm.getBlockTimestamp() + secs);
    }

    function _poke(address coin) internal {
        vm.prank(keeper);
        launcher.poke(coin);
    }

    /// The keeper checking every 10 minutes for `secs` (ends with a check at now + secs).
    function _pokeOver(address coin, uint256 secs) internal {
        for (uint256 t = 10 minutes; t <= secs; t += 10 minutes) {
            _skip(10 minutes);
            _poke(coin);
        }
    }

    function _level(address coin) internal view returns (uint8 lvl) {
        (,,,, lvl,,,) = launcher.states(coin);
    }

    function _held(address coin) internal view returns (uint256 n, uint256 k, bool settled) {
        (,,,,, settled, n, k) = launcher.states(coin);
    }

    /// Generates trading fees in both tokens.
    function _churn(address coin) internal {
        uint256 got = _buy(coin, 20 ether);
        _sell(coin, got / 2);
    }

    /// The launcher never keeps more native than what it holds for creators.
    function _checkBooks() internal view {
        assertEq(address(launcher).balance, launcher.heldNativeTotal(), "native books");
    }

    // ------------------------------------------------ launch

    function test_launch_sameLayoutAsV1() public {
        (address coin, uint256 bought) = _launch(1 ether);
        (uint256 tokenId, address pool, address cr, uint16 bps, bool is0) = launcher.coins(coin);
        assertEq(cr, creator);
        assertEq(bps, 2_000);
        assertEq(is0, coin < address(whype));
        assertEq(IERC721(npm).ownerOf(tokenId), address(launcher));
        assertEq(IERC20(coin).balanceOf(creator), bought);
        assertApproxEqAbs(IERC20(coin).balanceOf(pool) + bought, 1_000_000_000 ether, 1e12);
        (uint128 l1, uint128 l2, uint40 at, uint40 since, uint8 lvl, bool settled,,) = launcher.states(coin);
        assertEq(l1, L1);
        assertEq(l2, L2);
        assertEq(at, vm.getBlockTimestamp());
        assertEq(since, 0);
        assertEq(lvl, 0);
        assertFalse(settled);
        assertEq(ArkhamPadCoin(coin).creator(), creator);
    }

    function test_marketCapAtStart() public {
        (address coin,) = _launch(0);
        // the start price sits on the pool's tick grid (steps of ~2%), so it lands within ~2% of the
        // configured start (a little below when the coin is token0, a little above when it is token1)
        uint256 mc = launcher.marketCap(coin);
        assertLe(mc, START_MC * 1021 / 1000);
        assertGe(mc, START_MC * 979 / 1000);
        _buy(coin, 10 ether);
        assertGt(launcher.marketCap(coin), mc);
    }

    // ------------------------------------------------ the split below the first level

    function test_firstDay_20_65_15() public {
        (address coin,) = _launch(1 ether);
        _churn(coin);
        uint256 t0 = treasury.balance;
        uint256 c0 = creator.balance;
        uint256 ck0 = IERC20(coin).balanceOf(creator);
        (uint256 coinFees, uint256 nativeFees) = launcher.collect(coin);
        assertGt(coinFees, 0);
        assertGt(nativeFees, 0);
        assertEq(creator.balance - c0, nativeFees * 2_000 / 10_000);
        (uint256 hn, uint256 hk, bool settled) = _held(coin);
        assertEq(hn, nativeFees * 1_500 / 10_000);
        assertEq(hk, coinFees * 1_500 / 10_000);
        assertFalse(settled);
        assertEq(treasury.balance - t0, nativeFees - nativeFees * 2_000 / 10_000 - hn);
        assertEq(IERC20(coin).balanceOf(creator) - ck0, coinFees * 2_000 / 10_000);
        assertEq(IERC20(coin).balanceOf(address(launcher)), hk);
        _checkBooks();
    }

    function test_neverQualified_heldGoesToTreasury_then_20_80() public {
        (address coin,) = _launch(1 ether);
        _churn(coin);
        _poke(coin); // collects into the held share
        (uint256 hn, uint256 hk,) = _held(coin);
        assertGt(hn, 0);
        // still inside the 24 hours: stays held
        _skip(23 hours);
        _poke(coin);
        (,, bool settled) = _held(coin);
        assertFalse(settled);
        // after 24 hours: goes to ArkhamPad
        _skip(2 hours);
        uint256 t0 = treasury.balance;
        uint256 tk0 = IERC20(coin).balanceOf(treasury);
        _poke(coin);
        (uint256 hn2, uint256 hk2, bool settled2) = _held(coin);
        assertTrue(settled2);
        assertEq(hn2 + hk2, 0);
        assertEq(treasury.balance - t0, hn);
        assertEq(IERC20(coin).balanceOf(treasury) - tk0, hk);
        // from now on: 20 / 80, nothing held
        _churn(coin);
        uint256 c0 = creator.balance;
        uint256 t1 = treasury.balance;
        (, uint256 nf) = launcher.collect(coin);
        assertEq(creator.balance - c0, nf * 2_000 / 10_000);
        assertEq(treasury.balance - t1, nf - nf * 2_000 / 10_000);
        (hn2,,) = _held(coin);
        assertEq(hn2, 0);
        _checkBooks();
    }

    // ------------------------------------------------ reaching the first level

    function test_qualifyWithinFirstDay_heldToCreator_then_50_50() public {
        (address coin,) = _launch(1 ether);
        _churn(coin);
        launcher.collect(coin); // some held fees
        (uint256 hn, uint256 hk,) = _held(coin);
        assertGt(hn, 0);

        _skip(2 hours);
        _pumpTo(coin, L1);
        _poke(coin); // starts the hour
        (,,, uint40 since,,,,) = launcher.states(coin);
        assertEq(since, vm.getBlockTimestamp());
        assertEq(_level(coin), 0);

        _pokeOver(coin, 50 minutes);
        _skip(9 minutes);
        _poke(coin);
        assertEq(_level(coin), 0, "not before a full hour");

        _skip(1 minutes);
        uint256 c0 = creator.balance;
        uint256 ck0 = IERC20(coin).balanceOf(creator);
        (, uint256 hnBefore,) = (0, 0, false);
        hnBefore;
        (uint256 hnNow, uint256 hkNow,) = _held(coin);
        _poke(coin);
        assertEq(_level(coin), 1);
        (uint256 hn2, uint256 hk2, bool settled) = _held(coin);
        assertTrue(settled);
        assertEq(hn2 + hk2, 0);
        // the creator got the whole held amount (plus their 20% of fees collected in this poke)
        assertGe(creator.balance - c0, hnNow);
        assertGe(IERC20(coin).balanceOf(creator) - ck0, hkNow);
        assertGe(hnNow, hn);
        assertGe(hkNow, hk);

        // now 50 / 50
        _churn(coin);
        uint256 c1 = creator.balance;
        uint256 t1 = treasury.balance;
        (, uint256 nf) = launcher.collect(coin);
        assertEq(creator.balance - c1, nf * 5_000 / 10_000);
        assertEq(treasury.balance - t1, nf - nf * 5_000 / 10_000);
        _checkBooks();
    }

    function test_dropBelow_backTo_20_80_and_newFullHourNeeded() public {
        (address coin,) = _launch(1 ether);
        _pumpTo(coin, L1);
        _poke(coin);
        _pokeOver(coin, 1 hours);
        assertEq(_level(coin), 1);

        _dumpBelow(coin, L1);
        _poke(coin);
        assertEq(_level(coin), 0);
        (,,, uint40 since,,,,) = launcher.states(coin);
        assertEq(since, 0);
        _buy(coin, 1 ether);
        uint256 c0 = creator.balance;
        (, uint256 nf) = launcher.collect(coin);
        assertEq(creator.balance - c0, nf * 2_000 / 10_000, "20% after falling back");
        (uint256 hn,,) = _held(coin);
        assertEq(hn, 0, "nothing held once settled");

        // back above: a new full hour is needed
        _pumpTo(coin, L1);
        _poke(coin);
        _pokeOver(coin, 30 minutes);
        assertEq(_level(coin), 0);
        _pokeOver(coin, 30 minutes);
        assertEq(_level(coin), 1);
        _checkBooks();
    }

    function test_dipDuringTheHour_restartsTheHour() public {
        (address coin,) = _launch(1 ether);
        _pumpTo(coin, L1);
        _poke(coin);
        _skip(40 minutes);
        _dumpBelow(coin, L1);
        _poke(coin); // seen below: the hour restarts
        _pumpTo(coin, L1);
        _poke(coin);
        _pokeOver(coin, 40 minutes);
        assertEq(_level(coin), 0, "40 + 40 minutes with a dip is not an hour");
        _pokeOver(coin, 20 minutes);
        assertEq(_level(coin), 1);
    }

    function test_secondLevel_60_40() public {
        (address coin,) = _launch(1 ether);
        _pumpTo(coin, L2);
        _poke(coin);
        _pokeOver(coin, 1 hours);
        assertEq(_level(coin), 2);
        _churn(coin);
        uint256 c0 = creator.balance;
        uint256 t0 = treasury.balance;
        (, uint256 nf) = launcher.collect(coin);
        assertEq(creator.balance - c0, nf * 6_000 / 10_000);
        assertEq(treasury.balance - t0, nf - nf * 6_000 / 10_000);
        // falls between the levels: 50%
        _dumpBelow(coin, L2);
        if (launcher.marketCap(coin) >= L1) {
            _poke(coin);
            assertEq(_level(coin), 1);
        }
        _checkBooks();
    }

    // ------------------------------------------------ the 24-hour edge

    function test_hourStartsBeforeDeadline_endsAfter_creatorGetsHeld() public {
        (address coin,) = _launch(1 ether);
        _churn(coin);
        launcher.collect(coin);
        (uint256 hn,,) = _held(coin);
        assertGt(hn, 0);
        _skip(23 hours + 30 minutes);
        _pumpTo(coin, L1);
        _poke(coin); // hour starts at 23:30
        _pokeOver(coin, 40 minutes); // 24:10: past the 24 hours, hour still running
        (,, bool settled) = _held(coin);
        assertFalse(settled, "must wait for the running hour");
        _pokeOver(coin, 10 minutes);
        _skip(10 minutes); // 24:30: the hour is complete
        uint256 c0 = creator.balance;
        _poke(coin);
        (,, settled) = _held(coin);
        assertTrue(settled);
        assertEq(_level(coin), 1);
        assertGe(creator.balance - c0, hn);
        _checkBooks();
    }

    function test_hourStartsBeforeDeadline_dipsAfter_heldToTreasury() public {
        (address coin,) = _launch(1 ether);
        _churn(coin);
        launcher.collect(coin);
        (uint256 hn,,) = _held(coin);
        _skip(23 hours + 30 minutes);
        _pumpTo(coin, L1);
        _poke(coin);
        _skip(40 minutes);
        _dumpBelow(coin, L1);
        uint256 t0 = treasury.balance;
        _poke(coin); // below, after the 24 hours: the held share can't be earned any more
        (,, bool settled) = _held(coin);
        assertTrue(settled);
        assertGe(treasury.balance - t0, hn);
        _checkBooks();
    }

    function test_lateRiser_getsHigherShare_butNotTheHeld() public {
        (address coin,) = _launch(1 ether);
        _churn(coin);
        launcher.collect(coin);
        (uint256 hn,,) = _held(coin);
        _skip(3 days);
        _pumpTo(coin, L1);
        uint256 t0 = treasury.balance;
        _poke(coin); // starts an hour after the 24 hours: the held share goes to ArkhamPad now
        (,, bool settled) = _held(coin);
        assertTrue(settled);
        assertGe(treasury.balance - t0, hn);
        _pokeOver(coin, 1 hours);
        assertEq(_level(coin), 1, "a late riser still gets 50%");
        _churn(coin);
        uint256 c0 = creator.balance;
        (, uint256 nf) = launcher.collect(coin);
        assertEq(creator.balance - c0, nf * 5_000 / 10_000);
        _checkBooks();
    }

    // ------------------------------------------------ fees are split at the share they were earned under

    function test_pokeCollectsFirst_feesBeforeUpgradeAtOldShare() public {
        (address coin,) = _launch(1 ether);
        _skip(30 hours); // past the first day, nothing held
        _poke(coin);
        _pumpTo(coin, L1);
        _poke(coin); // hour starts (pump fees collected at 20/80)
        _pokeOver(coin, 50 minutes);
        assertEq(_level(coin), 0);
        _churn(coin); // fees earned while still below the higher share
        _skip(10 minutes);
        uint256 c0 = creator.balance;
        uint256 t0 = treasury.balance;
        _poke(coin); // collects those at 20/80, then moves to level 1
        uint256 toC = creator.balance - c0;
        uint256 toT = treasury.balance - t0;
        assertGt(toT, toC * 3, "collected at 20/80, not 50/50");
        assertEq(_level(coin), 1);
    }

    // ------------------------------------------------ who can do what

    function test_onlyKeeperOrOwnerPokes() public {
        (address coin,) = _launch(1 ether);
        vm.prank(trader);
        vm.expectRevert(ArkhamV3LauncherV2.NotKeeper.selector);
        launcher.poke(coin);
        Faker f = new Faker();
        vm.expectRevert(ArkhamV3LauncherV2.NotKeeper.selector);
        f.run(launcher, coin);
        address[] memory list = new address[](1);
        list[0] = coin;
        vm.prank(trader);
        vm.expectRevert(ArkhamV3LauncherV2.NotKeeper.selector);
        launcher.pokeMany(list);
        vm.prank(owner);
        launcher.poke(coin);
        vm.prank(keeper);
        launcher.pokeMany(list);
        // anyone collects (at the stored share)
        _churn(coin);
        vm.prank(trader);
        launcher.collect(coin);
        // the owner changes the keeper; the old one can't poke any more
        vm.prank(owner);
        launcher.setKeeper(address(0x1234));
        vm.prank(keeper);
        vm.expectRevert(ArkhamV3LauncherV2.NotKeeper.selector);
        launcher.poke(coin);
        vm.prank(trader);
        vm.expectRevert();
        launcher.setKeeper(trader);
    }

    function test_collectBySomeoneElse_doesNotChangeLevel() public {
        (address coin,) = _launch(1 ether);
        _pumpTo(coin, L1);
        _skip(2 hours);
        vm.prank(trader);
        launcher.collect(coin);
        assertEq(_level(coin), 0, "only poke moves levels");
    }

    function test_settings_futureCoinsOnly() public {
        (address coin,) = _launch(0);
        vm.prank(owner);
        launcher.setSettings(treasury, START_MC, 0, false, 800 ether, 3_200 ether);
        (uint128 l1,,,,,,,) = launcher.states(coin);
        assertEq(l1, L1, "an existing coin keeps its levels");
        (address coin2,) = _launch(0);
        (uint128 l1b, uint128 l2b,,,,,,) = launcher.states(coin2);
        assertEq(l1b, 800 ether);
        assertEq(l2b, 3_200 ether);
        vm.startPrank(owner);
        vm.expectRevert(ArkhamV3LauncherV2.BadSettings.selector);
        launcher.setSettings(treasury, START_MC, 0, false, START_MC, 3_200 ether); // level 1 must be above the start
        vm.expectRevert(ArkhamV3LauncherV2.BadSettings.selector);
        launcher.setSettings(treasury, START_MC, 0, false, 800 ether, 800 ether); // level 2 above level 1
        vm.expectRevert(ArkhamV3LauncherV2.BadSettings.selector);
        launcher.setSettings(address(0), START_MC, 0, false, 800 ether, 3_200 ether);
        launcher.setSettings(treasury, START_MC, 0, true, 800 ether, 3_200 ether);
        vm.stopPrank();
        vm.prank(trader);
        vm.expectRevert();
        launcher.setSettings(treasury, START_MC, 0, false, 800 ether, 3_200 ether);
        vm.prank(creator);
        vm.expectRevert(ArkhamV3LauncherV2.Paused.selector);
        launcher.launch("A", "A", "", address(0), 0);
    }

    function test_launchFee_minOut_callback_unknown() public {
        vm.prank(owner);
        launcher.setSettings(treasury, START_MC, 0.01 ether, false, L1, L2);
        vm.prank(creator);
        vm.expectRevert(ArkhamV3LauncherV2.FeeNotPaid.selector);
        launcher.launch{value: 0.001 ether}("A", "A", "", address(0), 0);
        vm.prank(creator);
        vm.expectRevert(ArkhamV3LauncherV2.TooLittleOut.selector);
        launcher.launch{value: 1 ether}("A", "A", "", address(0), 1_000_000_000 ether);
        vm.expectRevert(ArkhamV3LauncherV2.BadCallback.selector);
        launcher.uniswapV3SwapCallback(1, 0, "");
        vm.expectRevert(ArkhamV3LauncherV2.UnknownCoin.selector);
        launcher.collect(address(0xdead));
        vm.prank(keeper);
        vm.expectRevert(ArkhamV3LauncherV2.UnknownCoin.selector);
        launcher.poke(address(0xdead));
        vm.prank(trader);
        vm.expectRevert(ArkhamV3LauncherV2.BadCallback.selector);
        (bool ok,) = address(launcher).call{value: 1}("");
        ok;
    }

    function test_creatorWithoutNativeReceive_getsWrapped() public {
        NoNative nn = new NoNative();
        vm.prank(trader);
        (address coin,) = launcher.launch{value: 1 ether}("A", "A", "", address(nn), 0);
        _churn(coin);
        launcher.collect(coin);
        assertGt(whype.balanceOf(address(nn)), 0);
        _pumpTo(coin, L1);
        _poke(coin);
        _pokeOver(coin, 1 hours); // held released as wrapped, not a revert
        (,, bool settled) = _held(coin);
        assertTrue(settled);
        _checkBooks();
    }

    function test_noFees_noop() public {
        (address coin,) = _launch(0);
        (uint256 a, uint256 b) = launcher.collect(coin);
        assertEq(a + b, 0);
        _poke(coin);
        _checkBooks();
    }

    function test_status_view() public {
        (address coin,) = _launch(1 ether);
        (uint8 lvl, uint16 cb, uint16 hb, uint256 mc, uint256 l1, uint256 l2, uint256 at,, uint256 hn,, bool settled) = launcher.status(coin);
        assertEq(lvl, 0);
        assertEq(cb, 2_000);
        assertEq(hb, 1_500);
        assertGt(mc, 0);
        assertEq(l1, L1);
        assertEq(l2, L2);
        assertEq(at, vm.getBlockTimestamp());
        assertEq(hn, 0);
        assertFalse(settled);
        _skip(25 hours);
        (, cb, hb,,,,,,,,) = launcher.status(coin);
        assertEq(cb, 2_000);
        assertEq(hb, 0, "nothing held after the first day");
    }

    // ------------------------------------------------ random runs: books always balance, no double pay

    function testFuzz_randomLife(uint256 seed) public {
        (address coin,) = _launch(1 ether);
        uint256 paidHeldOut;
        for (uint256 i; i < 25; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 op = r % 5;
            if (op == 0) _buy(coin, 1 ether + (r >> 8) % 60 ether);
            else if (op == 1) {
                uint256 bal = IERC20(coin).balanceOf(trader);
                if (bal > 0) _sell(coin, bal / (2 + (r >> 8) % 4));
            } else if (op == 2) _skip((r >> 8) % 7 hours);
            else if (op == 3) {
                (,, bool before) = _held(coin);
                (uint256 hn,,) = _held(coin);
                _poke(coin);
                (,, bool after_) = _held(coin);
                if (!before && after_) paidHeldOut += hn;
            } else launcher.collect(coin);
            _checkBooks();
            (uint256 h,, bool s) = _held(coin);
            if (s) assertEq(h, 0, "settled means nothing left held");
            uint8 lvl = _level(coin);
            assertLe(lvl, 2);
        }
        // whatever happens, once 24h + 1h have passed and the coin is checked, the held share is settled
        _skip(26 hours);
        _dumpIfAbove(coin);
        _poke(coin);
        (uint256 hEnd,, bool sEnd) = _held(coin);
        assertTrue(sEnd);
        assertEq(hEnd, 0);
        assertEq(address(launcher).balance, 0);
        paidHeldOut;
    }

    // ------------------------------------------------ the independent review's attacks (must all fail now)

    /// A full hour of time is not enough: it also takes MIN_CHECKS checks in a row above the line.
    function test_hourWithTooFewChecks_noLevel() public {
        (address coin,) = _launch(1 ether);
        _pumpTo(coin, L1);
        _poke(coin);
        _skip(2 hours);
        _poke(coin);
        assertEq(_level(coin), 0, "2 checks are not enough");
        for (uint256 i; i < 3; ++i) _poke(coin);
        assertEq(_level(coin), 0, "5 checks are not enough");
        _poke(coin);
        assertEq(_level(coin), 1, "the 6th check in a row qualifies");
        (uint16 a1,) = launcher.checks(coin);
        assertEq(a1, 6);
        _dumpBelow(coin, L1);
        _poke(coin);
        (a1,) = launcher.checks(coin);
        assertEq(a1, 0, "a dip resets the count");
    }

    /// The second level also needs checks in a row (L2_CHECKS) at/above it.
    function test_level2_needsChecksInARow() public {
        (address coin,) = _launch(1 ether);
        _pumpTo(coin, L1);
        _poke(coin);
        _pokeOver(coin, 1 hours);
        assertEq(_level(coin), 1);
        _pumpTo(coin, L2);
        _poke(coin);
        assertEq(_level(coin), 1, "1 check at level 2");
        _poke(coin);
        assertEq(_level(coin), 1, "2 checks at level 2");
        _poke(coin);
        assertEq(_level(coin), 2, "3 checks in a row");
        // a dip below level 2 (still above level 1): back to 50% and the level-2 count starts over
        _dumpBelow(coin, L2);
        if (launcher.marketCap(coin) >= L1) {
            _poke(coin);
            assertEq(_level(coin), 1);
            (, uint16 a2) = launcher.checks(coin);
            assertEq(a2, 0);
        }
    }

    /// Review finding 1: a creator contract that pumps its coin when paid during the check can't fake the hour.
    function test_review_creatorPumpsInsidePoke_cannotFakeTheHour() public {
        Pumper p = new Pumper(router, address(whype));
        vm.deal(address(p), 100_000 ether);
        vm.prank(creator);
        (address coin,) = launcher.launch{value: 1 ether}("A", "A", "u", address(p), 0);
        for (uint256 i; i <= 14; ++i) {
            _buy(coin, 0.5 ether); // fees, so the check pays the creator
            assertLt(launcher.marketCap(coin), L1);
            p.arm(coin, 600 ether);
            _poke(coin);
            p.unwind();
            assertLt(launcher.marketCap(coin), L1);
            _skip(5 minutes);
        }
        assertEq(p.pumps(), 0, "the payout's small gas allowance leaves no room to trade");
        assertEq(_level(coin), 0, "no fake level");
        (,,, uint40 since,,,,) = launcher.states(coin);
        assertEq(since, 0, "never seen above");
        (,, bool settled) = _held(coin);
        assertFalse(settled, "held share not released");
        assertGt(whype.balanceOf(address(p)), 0, "its fee share arrived as WHYPE");
        _checkBooks();
    }

    /// Review finding 3: a creator contract that return-bombs or burns gas can't block its coin's fees or a batch.
    function test_review_bomberAndGasBurner_cannotBlockFees() public {
        Bomber b = new Bomber();
        GasBurner g = new GasBurner();
        vm.prank(creator);
        (address c1,) = launcher.launch{value: 1 ether}("A", "A", "u", address(b), 0);
        vm.prank(creator);
        (address c2,) = launcher.launch{value: 1 ether}("B", "B", "u", address(g), 0);
        (address good,) = _launch(1 ether);
        _churn(c1);
        _churn(c2);
        _churn(good);
        uint256 t0 = treasury.balance;
        (, uint256 nf) = launcher.collect(c1);
        assertGt(nf, 0);
        assertEq(whype.balanceOf(address(b)), nf * 2_000 / 10_000, "bomber paid in WHYPE");
        assertGt(treasury.balance, t0, "ArkhamPad paid");
        _churn(c1);
        address[] memory list = new address[](3);
        list[0] = c1;
        list[1] = c2;
        list[2] = good;
        vm.prank(keeper);
        launcher.pokeMany{gas: 3_000_000}(list);
        assertGt(whype.balanceOf(address(g)), 0, "gas burner paid in WHYPE");
        _checkBooks();
    }

    /// Review finding 2: setting up a coin's pool ahead of time at a wrong price can't block launches.
    function test_review_preInitializedPool_cannotBlockLaunches() public {
        // the old trick: guessing the next plain CREATE address does nothing now
        address guess = vm.computeCreateAddress(address(launcher), vm.getNonce(address(launcher)));
        _initPoolAt(guess);
        (address coin,) = _launch(1 ether);
        assertTrue(coin != guess);

        // even someone who knows everything about this block (same block, same caller, same names) only
        // blocks that one try: it fails cleanly and the next block's try works
        bytes32 salt = keccak256(
            abi.encode(creator, creator, launcher.coinCount(), vm.getBlockNumber(), vm.getBlockTimestamp(), "Elysium Cat", "ECAT")
        );
        bytes memory init = abi.encodePacked(
            type(ArkhamPadCoin).creationCode, abi.encode("Elysium Cat", "ECAT", "https://arkhampad.com/s/x", 1_000_000_000 ether, creator)
        );
        address exact = vm.computeCreate2Address(salt, keccak256(init), address(launcher));
        _initPoolAt(exact);
        vm.prank(creator);
        vm.expectRevert(ArkhamV3LauncherV2.PoolTaken.selector);
        launcher.launch{value: 1 ether}("Elysium Cat", "ECAT", "https://arkhampad.com/s/x", address(0), 0);
        vm.roll(vm.getBlockNumber() + 1);
        _skip(2);
        (address coin2, uint256 bought) = _launch(1 ether);
        assertTrue(coin2 != exact);
        assertGt(bought, 0);
        _checkBooks();
    }

    function _initPoolAt(address coinAddr) internal {
        address pool = IFactoryCreate(factory).createPool(coinAddr, address(whype), 10_000);
        bool is0 = coinAddr < address(whype);
        // a price inside the launcher's one-sided range
        IPoolInit(pool).initialize(is0 ? uint160(uint256(1 << 96) / 100) : uint160(uint256(1 << 96) * 100));
    }

    function test_badCreator_rejected() public {
        vm.startPrank(creator);
        vm.expectRevert(ArkhamV3LauncherV2.BadCreator.selector);
        launcher.launch{value: 1 ether}("A", "A", "u", address(launcher), 0);
        vm.expectRevert(ArkhamV3LauncherV2.BadCreator.selector);
        launcher.launch{value: 1 ether}("A", "A", "u", address(whype), 0);
        vm.stopPrank();
    }

    function _dumpIfAbove(address coin) internal {
        if (launcher.marketCap(coin) >= L1) _dumpBelow(coin, L1);
    }
}

/// The same tests with the coin as token1 (WHYPE at a low address).
contract ArkhamV3LauncherV2Token1Test is ArkhamV3LauncherV2Test {
    function setUp() public override {
        _setUp(address(0x0000000000000000000000000000000000001234));
    }
}
