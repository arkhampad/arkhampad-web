// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {PadHub} from "../src/PadHub.sol";
import {PadCurve} from "../src/PadCurve.sol";
import {PadCoin} from "../src/PadCoin.sol";
import {PadPoolBuilder} from "../src/PadPoolBuilder.sol";
import {PadInitGuard} from "../src/PadInitGuard.sol";
import {IPadHub} from "../src/interfaces.sol";
import {PadRouter} from "../src/PadRouter.sol";
import {PadPromote} from "../src/PadPromote.sol";

/// @notice Minimal swapper used by tests to trade in a v4 pool.
contract TestSwapper is IUnlockCallback {
    IPoolManager public immutable pm;
    constructor(IPoolManager pm_) { pm = pm_; }

    function swap(PoolKey memory key, bool zeroForOne, uint256 amountIn) external returns (uint256 out) {
        out = abi.decode(pm.unlock(abi.encode(msg.sender, key, zeroForOne, amountIn)), (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "pm");
        (address payer, PoolKey memory key, bool z, uint256 amountIn) = abi.decode(data, (address, PoolKey, bool, uint256));
        BalanceDelta d = pm.swap(key, SwapParams({zeroForOne: z, amountSpecified: -int256(amountIn),
            sqrtPriceLimitX96: z ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}), "");
        (Currency inC, Currency outC) = z ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        int128 inD = z ? d.amount0() : d.amount1();
        int128 outD = z ? d.amount1() : d.amount0();
        uint256 pay = uint256(uint128(-inD));
        uint256 out = uint256(uint128(outD));
        pm.sync(inC);
        IERC20(Currency.unwrap(inC)).transferFrom(payer, address(pm), pay);
        pm.settle();
        pm.take(outC, payer, out);
        return abi.encode(out);
    }
}

/// @notice Shared end-to-end flow, run against a local v4 deployment and against forks.
abstract contract PoolFlow is Test {
    IPoolManager pm;
    IPositionManager posm;
    IAllowanceTransfer permit2;
    IERC20 usdc;
    PadPoolBuilder builder;
    PadHub hub;
    TestSwapper swapper;
    PadRouter router;

    address admin = address(0xA11CE);
    address treasury = address(0x7EA5);
    address creator = address(0xC0DE);
    address alice = address(0xA1);
    address bob = address(0xB0B);

    uint256 constant FOR_SALE = 225403330717033245926072205;
    uint256 constant RESERVED = 774596669282966754073927795;

    function _fund(address who, uint256 amount) internal virtual;

    function _mineSalt(address deployer, bytes memory initCodeWithArgs) internal pure returns (bytes32 salt) {
        bytes32 h = keccak256(initCodeWithArgs);
        for (uint256 i; i < 400_000; ++i) {
            salt = bytes32(i);
            address a = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, h)))));
            if (uint160(a) & Hooks.ALL_HOOK_MASK == Hooks.BEFORE_INITIALIZE_FLAG) return salt;
        }
        revert("no salt");
    }

    function _deployPad() internal {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        bytes32 salt = _mineSalt(predicted, abi.encodePacked(type(PadInitGuard).creationCode, abi.encode(address(pm), predicted)));
        builder = new PadPoolBuilder(pm, posm, permit2, usdc, salt);
        assertEq(address(builder), predicted, "builder address prediction");
        hub = new PadHub(usdc, builder, PadHub.CurveParams({vUsdc: 4500e6, vCoin: 1e27, coinsForSale: FOR_SALE, coinsReserved: RESERVED}), admin, treasury);
        builder.bindHub(IPadHub(address(hub)));
        router = new PadRouter(hub, new PadPromote(usdc, admin, treasury), builder);
        vm.prank(admin);
        hub.setRouter(address(router));
        swapper = new TestSwapper(pm);
        _fund(alice, 100_000e6);
        _fund(bob, 100_000e6);
        _fund(creator, 1_000e6);
    }

    function _launchAndGraduate(PadCurve.FeeMode mode) internal returns (PadCoin coin, PadCurve curve) {
        vm.prank(creator);
        (address c, address cv) = hub.createCoin("Moonfrog", "MFROG", "ipfs://x", 0, mode, 0, 0);
        coin = PadCoin(c);
        curve = PadCurve(cv);
        vm.startPrank(alice);
        usdc.approve(cv, type(uint256).max);
        curve.buy(5_000e6, 0, alice);
        vm.stopPrank();
        assertEq(uint256(curve.phase()), uint256(PadCurve.Phase.Full));
        curve.graduate();
        assertEq(uint256(curve.phase()), uint256(PadCurve.Phase.Graduated));
    }

    function _flow_graduateTradeCollect() internal {
        (PadCoin coin, PadCurve curve) = _launchAndGraduate(PadCurve.FeeMode.ToCreator);
        (uint256 positionId,,) = builder.pools(address(coin));
        assertGt(positionId, 0, "position minted");
        assertEq(IERC721Like(address(posm)).ownerOf(positionId), address(builder), "builder owns the position");
        assertGt(posm.getPositionLiquidity(positionId), 0, "has liquidity");

        PoolKey memory key = builder.poolKeyFor(address(coin));
        bool u0 = builder.usdcIsCurrency0(address(coin));

        // Pool opens at the curve's last price (within 0.5%).
        uint256 coinsFor10 = _quoteOut(key, u0, 10e6);
        uint256 curvePriceCoinsPerUsdc = curve.vCoin() * 1e6 / curve.vUsdc(); // coins (18d) per 1 USDC
        assertApproxEqRel(coinsFor10, curvePriceCoinsPerUsdc * 10 * 99 / 100, 0.01e18, "pool price ~ curve price");

        // Bob buys and sells in the pool.
        vm.startPrank(bob);
        usdc.approve(address(swapper), type(uint256).max);
        IERC20(address(coin)).approve(address(swapper), type(uint256).max);
        uint256 got = swapper.swap(key, u0, 200e6);
        assertGt(got, 0, "bought in pool");
        uint256 back = swapper.swap(key, !u0, got / 2);
        assertGt(back, 0, "sold in pool");
        vm.stopPrank();

        // Creator lock does not exist here; collect fees and check the 70/30 split.
        uint256 t0 = usdc.balanceOf(treasury);
        uint256 c0 = usdc.balanceOf(creator);
        uint256 tc0 = coin.balanceOf(treasury);
        (uint256 uf, uint256 cf) = builder.collectFees(address(coin));
        assertGt(uf, 0, "usdc fees");
        assertGt(cf, 0, "coin fees");
        assertApproxEqAbs(usdc.balanceOf(treasury) - t0, uf - uf * 3000 / 10000, 1);
        assertApproxEqAbs(usdc.balanceOf(creator) - c0, uf * 3000 / 10000, 1);
        assertApproxEqAbs(coin.balanceOf(treasury) - tc0, cf - cf * 3000 / 10000, 1);
        // ~1% of the 200 USDC buy
        assertApproxEqRel(uf, 2e6, 0.02e18);

        // Liquidity can never be removed: the builder has no function for it,
        // and nobody else owns the position.
        vm.prank(bob);
        vm.expectRevert(PadPoolBuilder.NotACurve.selector);
        builder.buildPool(address(coin), 1, 1);
    }

    function _flow_buybackBurn() internal {
        (PadCoin coin, PadCurve curve) = _launchAndGraduate(PadCurve.FeeMode.BuybackBurn);
        uint256 have = curve.creatorFees();
        assertGt(have, 0);
        curve.settleCreatorFees();
        assertEq(builder.buybackFunds(address(coin)), have);
        uint256 burnBefore = coin.balanceOf(builder.BURN());
        (uint256 spent, uint256 burned) = builder.buyback(address(coin));
        assertEq(spent, have > 100e6 ? 100e6 : have);
        assertGt(burned, 0);
        assertEq(coin.balanceOf(builder.BURN()) - burnBefore, burned);
    }

    function _flow_guardBlocksEarlyPool() internal {
        vm.prank(creator);
        (address c,) = hub.createCoin("Early", "EARLY", "", 0, PadCurve.FeeMode.ToCreator, 0, 0);
        PoolKey memory key = builder.poolKeyFor(c);
        vm.expectRevert();
        pm.initialize(key, TickMath.getSqrtPriceAtTick(0));
    }

    /// Gasless: a user with only USDC (no ETH) permits, launches, buys and sells through the router.
    function _flow_gasless() internal {
        // A fresh, unguessable key: well-known test keys (like 0xC0FFEE) can hold
        // EIP-7702 delegations on real networks, which changes how USDC checks signatures.
        uint256 pk = uint256(keccak256(abi.encode("arkhampad gasless test user", block.chainid)));
        address u = vm.addr(pk);
        assertEq(u.code.length, 0, "test user must be a plain wallet");
        address relayer = address(0x5E1A);
        _fund(u, 500e6);
        assertEq(u.balance, 0, "user has no ETH");
        _permitTo(address(usdc), pk, u);
        PadRouter.Launch memory l = PadRouter.Launch({name: "Gasless", symbol: "GSL", metadataURI: "", lockSeconds: 0, feeMode: PadCurve.FeeMode.ToCreator, launchUsdc: 10e6, minCoinsOut: 0});
        uint256 dl = vm.getBlockTimestamp() + 60;
        bytes32 sh = keccak256(abi.encode(router.CREATE_TYPEHASH(), u, keccak256(bytes(l.name)), keccak256(bytes(l.symbol)), keccak256(bytes(l.metadataURI)), l.lockSeconds, uint8(l.feeMode), l.launchUsdc, l.minCoinsOut, uint256(0.01e6), uint256(1), dl));
        PadRouter.Sig memory s1 = PadRouter.Sig(dl, 1, _signR(pk, sh));
        vm.prank(relayer);
        (address coin, address curve) = router.launch(u, l, 0.01e6, s1);
        assertEq(PadCurve(curve).creator(), u);
        uint256 held = IERC20(coin).balanceOf(u);
        assertGt(held, 0);
        bytes32 bh = keccak256(abi.encode(router.BUY_TYPEHASH(), u, curve, uint256(25e6), uint256(1), uint256(0.01e6), uint256(2), dl));
        PadRouter.Sig memory s2 = PadRouter.Sig(dl, 2, _signR(pk, bh));
        vm.prank(relayer);
        uint256 got = router.buy(u, curve, 25e6, 1, 0.01e6, s2);
        _permitTo(coin, pk, u);
        uint256 total = held + got;
        bytes32 sl = keccak256(abi.encode(router.SELL_TYPEHASH(), u, curve, total, uint256(1), uint256(0.01e6), uint256(3), dl));
        uint256 before = usdc.balanceOf(u);
        PadRouter.Sig memory s3 = PadRouter.Sig(dl, 3, _signR(pk, sl));
        vm.prank(relayer);
        router.sell(u, curve, total, 1, 0.01e6, s3);
        assertGt(usdc.balanceOf(u), before, "got USDC back");
        assertEq(IERC20(coin).balanceOf(u), 0);
        assertEq(usdc.balanceOf(relayer), 0.03e6, "relayer repaid in USDC");
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(u.balance, 0, "user still never needed ETH");
    }

    /// Gasless trading in the locked pool after graduation: quote, buy, sell, slippage and guards.
    function _flow_gaslessPool() internal {
        uint256 pk = uint256(keccak256(abi.encode("arkhampad pool trader", block.chainid)));
        address u = vm.addr(pk);
        address relayer = address(0x5E1A);
        _fund(u, 1_000e6);
        _permitTo(address(usdc), pk, u);
        (PadCoin coin,) = _launchAndGraduate(PadCurve.FeeMode.ToCreator);
        uint256 dl = vm.getBlockTimestamp() + 60;

        // quote = what the buy really gives
        uint256 q = router.quotePool(address(coin), true, 50e6);
        assertGt(q, 0, "quote");
        // demanding one more coin than the quote fails
        PadRouter.Sig memory tight = PadRouter.Sig(dl, 10, _signR(pk, keccak256(abi.encode(router.POOL_BUY_TYPEHASH(), u, address(coin), uint256(50e6), q + 1, uint256(0.01e6), uint256(10), dl))));
        vm.prank(relayer);
        vm.expectRevert();
        router.poolBuy(u, address(coin), 50e6, q + 1, 0.01e6, tight);
        // exact quote fills
        PadRouter.Sig memory s1 = PadRouter.Sig(dl, 11, _signR(pk, keccak256(abi.encode(router.POOL_BUY_TYPEHASH(), u, address(coin), uint256(50e6), q, uint256(0.01e6), uint256(11), dl))));
        uint256 u0 = usdc.balanceOf(u);
        vm.prank(relayer);
        uint256 got = router.poolBuy(u, address(coin), 50e6, q, 0.01e6, s1);
        assertEq(got, q, "got the quoted amount");
        assertEq(coin.balanceOf(u), got);
        assertEq(u0 - usdc.balanceOf(u), 50e6 + 0.01e6);

        // sell everything back
        _permitTo(address(coin), pk, u);
        uint256 qs = router.quotePool(address(coin), false, got);
        PadRouter.Sig memory s2 = PadRouter.Sig(dl, 12, _signR(pk, keccak256(abi.encode(router.POOL_SELL_TYPEHASH(), u, address(coin), got, qs - 0.01e6, uint256(0.01e6), uint256(12), dl))));
        uint256 u1 = usdc.balanceOf(u);
        vm.prank(relayer);
        uint256 back = router.poolSell(u, address(coin), got, qs - 0.01e6, 0.01e6, s2);
        assertEq(back, qs - 0.01e6, "sold at the quote");
        assertEq(usdc.balanceOf(u) - u1, back);
        assertEq(coin.balanceOf(u), 0);
        assertApproxEqRel(back, 50e6 * 98 / 100, 0.01e18, "round trip loses ~2% (1% pool fee each way)");
        assertEq(usdc.balanceOf(address(router)), 0, "router keeps no USDC");
        assertEq(coin.balanceOf(address(router)), 0, "router keeps no coins");
        assertEq(u.balance, 0, "user never needed ETH");
        assertEq(usdc.balanceOf(relayer), 0.02e6);
    }

    /// Pool trading is refused before a coin graduates.
    function _flow_poolNeedsGraduation() internal {
        uint256 pk = uint256(keccak256(abi.encode("arkhampad early pool", block.chainid)));
        address u = vm.addr(pk);
        _fund(u, 100e6);
        _permitTo(address(usdc), pk, u);
        vm.prank(creator);
        (address c,) = hub.createCoin("Early", "ERLY", "", 0, PadCurve.FeeMode.ToCreator, 0, 0);
        uint256 dl = vm.getBlockTimestamp() + 60;
        PadRouter.Sig memory s = PadRouter.Sig(dl, 1, _signR(pk, keccak256(abi.encode(router.POOL_BUY_TYPEHASH(), u, c, uint256(10e6), uint256(0), uint256(0), uint256(1), dl))));
        vm.expectRevert(PadRouter.NotGraduated.selector);
        router.poolBuy(u, c, 10e6, 0, 0, s);
        vm.expectRevert(PadRouter.NotGraduated.selector);
        router.quotePool(c, true, 10e6);
    }

    function _signR(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", router.domainSeparator(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _permitTo(address token, uint256 pk, address owner) internal {
        bytes32 PERMIT = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        uint256 dl = vm.getBlockTimestamp() + 1 hours;
        bytes32 sh = keccak256(abi.encode(PERMIT, owner, address(router), type(uint256).max, IPermitView(token).nonces(owner), dl));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", IPermitView(token).DOMAIN_SEPARATOR(), sh)));
        // Call the token directly first so a failure shows the token's own reason.
        try IPermitCall(token).permit(owner, address(router), type(uint256).max, dl, v, r, s) {}
        catch Error(string memory reason) { revert(string.concat("permit failed: ", reason)); }
        catch (bytes memory data) { console2.logBytes(data); revert("permit failed (no reason)"); }
        assertEq(IERC20(token).allowance(owner, address(router)), type(uint256).max, "permit worked");
    }

    function _quoteOut(PoolKey memory key, bool zeroForOne, uint256 amountIn) internal returns (uint256 out) {
        uint256 snap = vm.snapshotState();
        vm.startPrank(bob);
        usdc.approve(address(swapper), type(uint256).max);
        out = swapper.swap(key, zeroForOne, amountIn);
        vm.stopPrank();
        vm.revertToState(snap);
    }
}

interface IPermitCall {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}

interface IPermitView {
    function nonces(address) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

interface IERC721Like {
    function ownerOf(uint256) external view returns (address);
}
