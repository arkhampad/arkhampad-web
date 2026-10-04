// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PadHub} from "../src/PadHub.sol";
import {PadCurve} from "../src/PadCurve.sol";
import {PadCoin} from "../src/PadCoin.sol";
import {PadPromote} from "../src/PadPromote.sol";
import {PadRouter} from "../src/PadRouter.sol";
import {PadPoolBuilder} from "../src/PadPoolBuilder.sol";
import {MockUSDC, MockPoolBuilder} from "./Mocks.sol";

contract RouterTest is Test {
    MockUSDC usdc;
    PadHub hub;
    PadPromote promo;
    PadRouter router;
    address admin = address(0xA11CE);
    address treasury = address(0x7EA5);
    address relayer = address(0x5E1A);
    uint256 alicePk = 0xA1;
    address alice;
    uint256 bobPk = 0xB0B;
    address bob;

    uint256 constant FOR_SALE = 225403330717033245926072205;
    uint256 constant RESERVED = 774596669282966754073927795;

    function setUp() public {
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        usdc = new MockUSDC();
        MockPoolBuilder b = new MockPoolBuilder(IERC20(address(usdc)));
        hub = new PadHub(IERC20(address(usdc)), b, PadHub.CurveParams({vUsdc: 4500e6, vCoin: 1e27, coinsForSale: FOR_SALE, coinsReserved: RESERVED}), admin, treasury);
        promo = new PadPromote(IERC20(address(usdc)), admin, treasury);
        router = new PadRouter(hub, promo, PadPoolBuilder(address(0)));
        vm.prank(admin);
        hub.setRouter(address(router));
        usdc.mint(alice, 10_000e6);
        usdc.mint(bob, 10_000e6);
        // gasless approval: alice signs a USDC permit, the relayer submits it
        _permitUsdc(alicePk, alice, type(uint256).max);
        _permitUsdc(bobPk, bob, type(uint256).max);
    }

    // ------------------------------------------------------------- signing helpers
    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", router.domainSeparator(), structHash));
    }
    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(structHash));
        return abi.encodePacked(r, s, v);
    }
    function _permitUsdc(uint256 pk, address owner, uint256 value) internal {
        _permit(address(usdc), pk, owner, value);
    }
    function _permit(address token, uint256 pk, address owner, uint256 value) internal {
        bytes32 PERMIT = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        uint256 dl = block.timestamp + 1 hours;
        bytes32 sh = keccak256(abi.encode(PERMIT, owner, address(router), value, IERC20PermitLike(token).nonces(owner), dl));
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", IERC20PermitLike(token).DOMAIN_SEPARATOR(), sh));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        vm.prank(relayer);
        router.permit(token, owner, value, dl, v, r, s);
    }
    function _sig(uint256 pk, bytes32 sh, uint256 nonce, uint256 dl) internal view returns (PadRouter.Sig memory) {
        return PadRouter.Sig({deadline: dl, nonce: nonce, signature: _sign(pk, sh)});
    }
    function _buySig(uint256 pk, address user, address curve, uint256 usdcIn, uint256 minOut, uint256 fee, uint256 nonce) internal view returns (PadRouter.Sig memory) {
        uint256 dl = vm.getBlockTimestamp() + 60;
        return _sig(pk, keccak256(abi.encode(router.BUY_TYPEHASH(), user, curve, usdcIn, minOut, fee, nonce, dl)), nonce, dl);
    }
    function _sellSig(uint256 pk, address user, address curve, uint256 amt, uint256 minOut, uint256 fee, uint256 nonce) internal view returns (PadRouter.Sig memory) {
        uint256 dl = vm.getBlockTimestamp() + 60;
        return _sig(pk, keccak256(abi.encode(router.SELL_TYPEHASH(), user, curve, amt, minOut, fee, nonce, dl)), nonce, dl);
    }
    function _launch(uint256 pk, address user, uint256 launchUsdc, uint256 lock, uint256 fee, uint256 nonce) internal returns (address coin, address curve) {
        PadRouter.Launch memory l = PadRouter.Launch({name: "Moonfrog", symbol: "MFROG", metadataURI: "ipfs://m", lockSeconds: lock, feeMode: PadCurve.FeeMode.ToCreator, launchUsdc: launchUsdc, minCoinsOut: 0});
        uint256 dl = vm.getBlockTimestamp() + 60;
        bytes32 sh = keccak256(abi.encode(router.CREATE_TYPEHASH(), user, keccak256(bytes(l.name)), keccak256(bytes(l.symbol)), keccak256(bytes(l.metadataURI)), l.lockSeconds, uint8(l.feeMode), l.launchUsdc, l.minCoinsOut, fee, nonce, dl));
        PadRouter.Sig memory s = _sig(pk, sh, nonce, dl);
        vm.prank(relayer);
        return router.launch(user, l, fee, s);
    }
    function _assertRouterEmpty(address coin) internal view {
        assertEq(usdc.balanceOf(address(router)), 0, "router keeps no USDC");
        if (coin != address(0)) assertEq(IERC20(coin).balanceOf(address(router)), 0, "router keeps no coins");
    }

    // ------------------------------------------------------------- launch
    function test_gaslessLaunch() public {
        uint256 a0 = usdc.balanceOf(alice);
        (address coin, address curve) = _launch(alicePk, alice, 20e6, 0, 0.01e6, 1);
        assertEq(PadCurve(curve).creator(), alice, "creator is the signer, not the router");
        assertGt(IERC20(coin).balanceOf(alice), 0, "launch buy coins to alice");
        assertEq(a0 - usdc.balanceOf(alice), 20e6 + 0.01e6);
        assertEq(usdc.balanceOf(relayer), 0.01e6, "relayer paid back in USDC");
        _assertRouterEmpty(coin);
        assertEq(PadCurve(curve).creatorFees(), 0, "launch buy pays full fee to platform");
    }

    function test_onlyRouterCreatesFor() public {
        vm.prank(alice);
        vm.expectRevert(PadHub.NotAllowed.selector);
        hub.createCoinFor(alice, "X", "X", "", 0, PadCurve.FeeMode.ToCreator, 0, 0);
    }

    // ------------------------------------------------------------- buy & sell
    function test_gaslessBuyAndSell() public {
        (address coin, address curve) = _launch(alicePk, alice, 0, 0, 0, 1);
        uint256 b0 = usdc.balanceOf(bob);
        PadRouter.Sig memory s = _buySig(bobPk, bob, curve, 101e6, 1, 0.02e6, 7);
        vm.prank(relayer);
        uint256 got = router.buy(bob, curve, 101e6, 1, 0.02e6, s);
        assertEq(IERC20(coin).balanceOf(bob), got);
        assertEq(b0 - usdc.balanceOf(bob), 101e6 + 0.02e6);
        assertEq(PadCurve(curve).usdcReserve(), 100e6);
        _assertRouterEmpty(coin);

        // sell: gasless coin approval by permit, then a signed sell
        _permit(coin, bobPk, bob, type(uint256).max);
        uint256 q = PadCurve(curve).quoteSell(got);
        PadRouter.Sig memory s2 = _sellSig(bobPk, bob, curve, got, q - 0.02e6, 0.02e6, 8);
        uint256 b1 = usdc.balanceOf(bob);
        vm.prank(relayer);
        uint256 out = router.sell(bob, curve, got, q - 0.02e6, 0.02e6, s2);
        assertEq(out, q - 0.02e6);
        assertEq(usdc.balanceOf(bob) - b1, out);
        assertEq(IERC20(coin).balanceOf(bob), 0);
        assertEq(usdc.balanceOf(relayer), 0.04e6);
        _assertRouterEmpty(coin);
    }

    function test_buyThatFillsRefundsRest() public {
        (address coin, address curve) = _launch(alicePk, alice, 0, 0, 0, 1);
        uint256 b0 = usdc.balanceOf(bob);
        PadRouter.Sig memory s = _buySig(bobPk, bob, curve, 5000e6, 0, 0, 2);
        vm.prank(relayer);
        router.buy(bob, curve, 5000e6, 0, 0, s);
        assertEq(uint256(PadCurve(curve).phase()), uint256(PadCurve.Phase.Full));
        assertApproxEqAbs(b0 - usdc.balanceOf(bob), 1309475019 + 13094751, 3, "only what was needed");
        _assertRouterEmpty(coin);
    }

    function test_limitOrderNeverFillsWorse() public {
        (, address curve) = _launch(alicePk, alice, 0, 0, 0, 1);
        // bob signs a buy that demands more coins than the price gives now
        uint256 q = PadCurve(curve).quoteBuy(50e6);
        PadRouter.Sig memory s = _buySig(bobPk, bob, curve, 50e6, q + 1, 0, 3);
        vm.prank(relayer);
        vm.expectRevert();
        router.buy(bob, curve, 50e6, q + 1, 0, s);
        // after the price drops (someone sells), the same signed order fills
        PadRouter.Sig memory sa = _buySig(alicePk, alice, curve, 500e6, 0, 0, 4);
        vm.prank(relayer);
        uint256 got = router.buy(alice, curve, 500e6, 0, 0, sa);
        _permit(address(PadCurve(curve).coin()), alicePk, alice, type(uint256).max);
        PadRouter.Sig memory ss = _sellSig(alicePk, alice, curve, got, 0, 0, 5);
        vm.prank(relayer);
        router.sell(alice, curve, got, 0, 0, ss);
        // price is now a hair lower than at signing (fees) -> order can fill
        uint256 q2 = PadCurve(curve).quoteBuy(50e6);
        if (q2 >= q + 1) {
            vm.prank(relayer);
            router.buy(bob, curve, 50e6, q + 1, 0, s);
        }
    }

    function test_sellFeeAboveOutReverts() public {
        (address coin, address curve) = _launch(alicePk, alice, 0, 0, 0, 1);
        PadRouter.Sig memory s = _buySig(bobPk, bob, curve, 1e6, 0, 0, 2);
        vm.prank(relayer);
        uint256 got = router.buy(bob, curve, 1e6, 0, 0, s);
        _permit(coin, bobPk, bob, type(uint256).max);
        PadRouter.Sig memory s2 = _sellSig(bobPk, bob, curve, got, 0, 5e6, 3);
        vm.prank(relayer);
        vm.expectRevert(PadRouter.FeeTooHigh.selector);
        router.sell(bob, curve, got, 0, 5e6, s2);
    }

    function test_creatorLockAppliesThroughRouter() public {
        (address coin, address curve) = _launch(alicePk, alice, 20e6, 1 hours, 0, 1);
        _permit(coin, alicePk, alice, type(uint256).max);
        uint256 bal = IERC20(coin).balanceOf(alice);
        PadRouter.Sig memory s = _sellSig(alicePk, alice, curve, bal, 0, 0, 2);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(PadCoin.CreatorLocked.selector, PadCoin(coin).unlockTime()));
        router.sell(alice, curve, bal, 0, 0, s);
    }

    // ------------------------------------------------------------- signature rules
    function test_replayExpiredWrongSignerAndFakeCurve() public {
        (, address curve) = _launch(alicePk, alice, 0, 0, 0, 1);
        PadRouter.Sig memory s = _buySig(bobPk, bob, curve, 10e6, 0, 0, 9);
        vm.prank(relayer);
        router.buy(bob, curve, 10e6, 0, 0, s);
        vm.prank(relayer);
        vm.expectRevert(PadRouter.NonceAlreadyUsed.selector);
        router.buy(bob, curve, 10e6, 0, 0, s);

        PadRouter.Sig memory late = _buySig(bobPk, bob, curve, 10e6, 0, 0, 10);
        vm.warp(vm.getBlockTimestamp() + 61);
        vm.prank(relayer);
        vm.expectRevert(PadRouter.Expired.selector);
        router.buy(bob, curve, 10e6, 0, 0, late);

        // alice signs, but the request says bob: rejected
        PadRouter.Sig memory forged = _buySig(alicePk, bob, curve, 10e6, 0, 0, 11);
        vm.prank(relayer);
        vm.expectRevert(PadRouter.BadSignature.selector);
        router.buy(bob, curve, 10e6, 0, 0, forged);

        // amounts changed after signing: rejected
        PadRouter.Sig memory s3 = _buySig(bobPk, bob, curve, 10e6, 0, 0, 12);
        vm.prank(relayer);
        vm.expectRevert(PadRouter.BadSignature.selector);
        router.buy(bob, curve, 900e6, 0, 0, s3);

        PadRouter.Sig memory s4 = _buySig(bobPk, bob, address(usdc), 10e6, 0, 0, 13);
        vm.prank(relayer);
        vm.expectRevert(PadRouter.NotACurve.selector);
        router.buy(bob, address(usdc), 10e6, 0, 0, s4);
    }

    function test_cancel() public {
        (, address curve) = _launch(alicePk, alice, 0, 0, 0, 1);
        PadRouter.Sig memory s = _buySig(bobPk, bob, curve, 10e6, 0, 0, 20);
        // signed cancel, submitted by the relayer
        bytes memory c = _sign(bobPk, keccak256(abi.encode(router.CANCEL_TYPEHASH(), bob, uint256(20))));
        vm.prank(relayer);
        router.cancel(bob, 20, c);
        vm.prank(relayer);
        vm.expectRevert(PadRouter.NonceAlreadyUsed.selector);
        router.buy(bob, curve, 10e6, 0, 0, s);
        // direct cancel by the user; someone else cannot cancel for bob without his signature
        vm.prank(bob);
        router.cancel(bob, 21, "");
        vm.prank(alice);
        vm.expectRevert();
        router.cancel(bob, 22, hex"00");
    }

    // ------------------------------------------------------------- withdraw & promote
    function test_withdraw() public {
        address ext = address(0xE1);
        uint256 dl = vm.getBlockTimestamp() + 60;
        bytes32 sh = keccak256(abi.encode(router.WITHDRAW_TYPEHASH(), alice, ext, 250e6, 0.03e6, uint256(30), dl));
        PadRouter.Sig memory s = _sig(alicePk, sh, 30, dl);
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(relayer);
        router.withdraw(alice, ext, 250e6, 0.03e6, s);
        assertEq(usdc.balanceOf(ext), 250e6);
        assertEq(a0 - usdc.balanceOf(alice), 250e6 + 0.03e6);
        assertEq(usdc.balanceOf(relayer), 0.03e6);
        // the relayer cannot redirect it
        bytes32 sh2 = keccak256(abi.encode(router.WITHDRAW_TYPEHASH(), alice, ext, 10e6, 0, uint256(31), dl));
        PadRouter.Sig memory s2 = _sig(alicePk, sh2, 31, dl);
        vm.prank(relayer);
        vm.expectRevert(PadRouter.BadSignature.selector);
        router.withdraw(alice, relayer, 10e6, 0, s2);
    }

    function test_promote() public {
        (address coin,) = _launch(alicePk, alice, 0, 0, 0, 1);
        uint256 dl = vm.getBlockTimestamp() + 60;
        bytes32 sh = keccak256(abi.encode(router.PROMOTE_TYPEHASH(), bob, coin, uint256(84532), uint8(2), uint256(20e6), uint256(0.01e6), uint256(40), dl));
        PadRouter.Sig memory s = _sig(bobPk, sh, 40, dl);
        vm.prank(relayer);
        router.promote(bob, coin, 84532, 2, 20e6, 0.01e6, s);
        assertEq(usdc.balanceOf(treasury), 20e6);
        _assertRouterEmpty(coin);
        // price raised above what bob signed: rejected
        vm.prank(admin);
        promo.setPlan(2, 24 hours, 30e6, true);
        bytes32 sh2 = keccak256(abi.encode(router.PROMOTE_TYPEHASH(), bob, coin, uint256(84532), uint8(2), uint256(20e6), uint256(0), uint256(41), dl));
        PadRouter.Sig memory s2 = _sig(bobPk, sh2, 41, dl);
        vm.prank(relayer);
        vm.expectRevert();
        router.promote(bob, coin, 84532, 2, 20e6, 0, s2);
    }

    // ------------------------------------------------------------- fuzz: router never keeps funds, user balances add up
    function testFuzz_roundTrips(uint96 a, uint96 b, uint16 feeBps) public {
        (address coin, address curve) = _launch(alicePk, alice, 0, 0, 0, 1);
        uint256 x = bound(a, 1e4, 3000e6);
        uint256 fee = bound(feeBps, 0, 100) * 1e3; // up to $0.10
        PadRouter.Sig memory s = _buySig(bobPk, bob, curve, x, 0, fee, 100);
        uint256 b0 = usdc.balanceOf(bob);
        vm.prank(relayer);
        uint256 got = router.buy(bob, curve, x, 0, fee, s);
        _assertRouterEmpty(coin);
        if (uint256(PadCurve(curve).phase()) == 0 && got > 0) {
            uint256 part = bound(b, 1, got);
            _permit(coin, bobPk, bob, type(uint256).max);
            uint256 q = PadCurve(curve).quoteSell(part);
            if (q > fee) {
                PadRouter.Sig memory s2 = _sellSig(bobPk, bob, curve, part, 0, fee, 101);
                vm.prank(relayer);
                router.sell(bob, curve, part, 0, fee, s2);
                _assertRouterEmpty(coin);
            }
        }
        assertLe(usdc.balanceOf(bob), b0, "no free money");
    }
}

interface IERC20PermitLike {
    function nonces(address) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}
