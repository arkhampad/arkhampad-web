// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {PadHub} from "../src/PadHub.sol";
import {ArkhamPadCoin} from "../src/PadCoin.sol";
import {PadPoolBuilder} from "../src/PadPoolBuilder.sol";
import {PadLaunchHook} from "../src/PadLaunchHook.sol";
import {FeeMode} from "../src/PadTypes.sol";
import {IPadHub} from "../src/interfaces.sol";
import {PadRouter} from "../src/PadRouter.sol";
import {PadPromote} from "../src/PadPromote.sol";

/// @notice Minimal swapper standing in for any outside app (aggregator, trading app, DEX UI).
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

/// @notice Shared end-to-end flow for the instant-pool launch, run locally and against forks.
abstract contract LaunchFlow is Test {
    IPoolManager pm;
    IPositionManager posm;
    IAllowanceTransfer permit2;
    IERC20 usdc;
    uint256 internal D = 1_000_000;
    PadPoolBuilder builder;
    PadHub hub;
    PadLaunchHook hook;
    TestSwapper swapper;
    PadRouter router;

    address admin = address(0xA11CE);
    address treasury = address(0x7EA5);
    address creator = address(0xC0DE);
    address alice = address(0xA1);
    address bob = address(0xB0B);

    uint256 constant SUPPLY = 1_000_000_000e18;

    function _fund(address who, uint256 amount) internal virtual;

    function _mineSalt(address deployer, bytes memory initCodeWithArgs) internal pure returns (bytes32 salt) {
        bytes32 h = keccak256(initCodeWithArgs);
        uint160 want = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG;
        for (uint256 i; i < 1_000_000; ++i) {
            salt = bytes32(i);
            address a = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, h)))));
            if (uint160(a) & Hooks.ALL_HOOK_MASK == want) return salt;
        }
        revert("no salt");
    }

    function _deployPad() internal {
        D = 10 ** IERC20Metadata(address(usdc)).decimals();
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        bytes32 salt = _mineSalt(predicted, abi.encodePacked(type(PadLaunchHook).creationCode, abi.encode(address(pm), predicted)));
        builder = new PadPoolBuilder(pm, posm, permit2, usdc, salt);
        assertEq(address(builder), predicted, "builder address prediction");
        hook = builder.guard();
        hub = new PadHub(usdc, builder, 4500 * D, 5 * D, admin, treasury);
        builder.bindHub(IPadHub(address(hub)));
        router = new PadRouter(hub, new PadPromote(usdc, admin, treasury), builder);
        vm.prank(admin);
        hub.setRouter(address(router));
        swapper = new TestSwapper(pm);
        _fund(alice, 100_000 * D);
        _fund(bob, 100_000 * D);
        _fund(creator, 1_000 * D);
    }

    /// Launches a coin. `launchUsdc` 0 means the $5 minimum; that launch buy's fee is
    /// collected right away so each test starts from a clean fee slate.
    function _launch(FeeMode mode, uint256 launchUsdc) internal returns (ArkhamPadCoin coin) {
        bool minimum = launchUsdc == 0;
        if (minimum) launchUsdc = 5 * D;
        vm.startPrank(creator);
        usdc.approve(address(hub), launchUsdc);
        coin = ArkhamPadCoin(hub.createCoin("Moonfrog", "MFROG", "ipfs://x", 0, mode, launchUsdc, 0));
        vm.stopPrank();
        if (minimum) builder.collectFees(address(coin));
    }

    /// An outside app buys: USDC in, coins out.
    function _extBuy(address who, address coin, uint256 usdcIn) internal returns (uint256 out) {
        PoolKey memory key = builder.poolKeyFor(coin);
        vm.startPrank(who);
        usdc.approve(address(swapper), type(uint256).max);
        out = swapper.swap(key, builder.usdcIsCurrency0(coin), usdcIn);
        vm.stopPrank();
    }

    function _extSell(address who, address coin, uint256 coins) internal returns (uint256 out) {
        PoolKey memory key = builder.poolKeyFor(coin);
        vm.startPrank(who);
        IERC20(coin).approve(address(swapper), type(uint256).max);
        out = swapper.swap(key, !builder.usdcIsCurrency0(coin), coins);
        vm.stopPrank();
    }

    /// Coins a buy of `usdcAfterFee` gets from a fresh pool: the position behaves like a
    /// constant product with the launch market cap as virtual USDC.
    function _fresh(uint256 usdcAfterFee) internal view returns (uint256) {
        return SUPPLY * usdcAfterFee / (4500 * D + usdcAfterFee);
    }

    /// Coins a buy would get, without changing anything.
    function _quoteBuy(address coin, uint256 usdcIn) internal returns (uint256 out) {
        uint256 snap = vm.snapshotState();
        out = _extBuy(bob, coin, usdcIn);
        vm.revertToState(snap);
    }

    // ---------------------------------------------------------------- flows

    /// Launch opens a real pool at once: the whole supply is locked liquidity
    /// at the launch price, and the coin can be bought by anyone, from any app.
    function _flow_launchOpensPool() internal {
        ArkhamPadCoin coin = _launch(FeeMode.ToCreator, 0);
        (uint256 positionId, address cr,) = builder.pools(address(coin));
        assertGt(positionId, 0, "position minted");
        assertEq(cr, creator);
        assertEq(IERC721Like(address(posm)).ownerOf(positionId), address(builder), "builder owns the position");
        assertGt(posm.getPositionLiquidity(positionId), 0, "has liquidity");
        assertEq(coin.totalSupply(), SUPPLY);
        assertEq(coin.balanceOf(address(builder)), 0, "no coins left outside the pool");
        uint256 launchBought = coin.balanceOf(creator);
        assertGt(launchBought, 0, "the $5 launch buy is the pool's first trade");
        assertGe(coin.balanceOf(address(pm)) + coin.balanceOf(builder.BURN()) + launchBought, SUPPLY - 1e18, "supply is in the pool");
        assertGt(coin.balanceOf(address(pm)), SUPPLY * 99 / 100, "almost all of it");
        assertTrue(hub.isCoin(address(coin)));

        // After the launch window, a $10 buy pays 2% and gets ~$9.80 of coins at a $4.5K market cap.
        vm.warp(vm.getBlockTimestamp() + 301);
        uint256 got = _quoteBuy(address(coin), 10 * D);
        // The start price is rounded to the pool's tick grid, so it can be up to ~2% higher.
        assertApproxEqRel(got, _fresh(10 * D * 98 / 100), 0.025e18, "starts at ~$4.5K market cap");
        assertLe(got, _fresh(10 * D * 98 / 100), "never cheaper than $4.5K");
    }

    /// The fee falls from 10% to 2% over two minutes and the hook reports it.
    function _flow_feeSchedule() internal {
        assertEq(hook.feeAt(1000, 1000), 100_000);
        assertEq(hook.feeAt(1000, 1060), 60_000);
        assertEq(hook.feeAt(1000, 1120), 20_000);
        assertEq(hook.feeAt(1000, 99999), 20_000);
        ArkhamPadCoin coin = _launch(FeeMode.ToCreator, 0);
        PoolKey memory key = builder.poolKeyFor(address(coin));
        assertEq(hook.currentFee(key), 100_000, "10% at launch");
        assertEq(key.fee, LPFeeLibrary.DYNAMIC_FEE_FLAG, "dynamic fee pool");

        // Same $100 buy: at launch it gets ~90/98 of what it gets after two minutes.
        uint256 early = _quoteBuy(address(coin), 100 * D);
        vm.warp(vm.getBlockTimestamp() + 60);
        assertEq(hook.currentFee(key), 60_000, "6% half way");
        uint256 mid = _quoteBuy(address(coin), 100 * D);
        vm.warp(vm.getBlockTimestamp() + 60);
        uint256 late = _quoteBuy(address(coin), 100 * D);
        // ratios as the pool sees them (fee comes off the input, then price impact)
        assertApproxEqRel(early * _fresh(98 * D), late * _fresh(90 * D), 0.002e18, "10% fee at launch");
        assertApproxEqRel(mid * _fresh(98 * D), late * _fresh(94 * D), 0.002e18, "6% fee half way");
    }

    /// Snipers pay the launch fee, and it lands in the pool's fees: 70% platform, 30% creator.
    function _flow_sniperFeesSplit() internal {
        ArkhamPadCoin coin = _launch(FeeMode.ToCreator, 0);
        _extBuy(alice, address(coin), 1_000 * D); // a bot buying in the first block
        uint256 t0 = usdc.balanceOf(treasury);
        uint256 c0 = usdc.balanceOf(creator);
        (uint256 uf,) = builder.collectFees(address(coin));
        assertApproxEqRel(uf, 100 * D, 0.001e18, "10% of the sniper's 1000 USDC");
        assertApproxEqAbs(usdc.balanceOf(treasury) - t0, uf - uf * 3000 / 10000, 1, "70% platform");
        assertApproxEqAbs(usdc.balanceOf(creator) - c0, uf * 3000 / 10000, 1, "30% creator");
    }

    /// Trades from any app pay 2% after launch; fees in both currencies are split 70/30.
    function _flow_outsideTradesPayUs() internal {
        ArkhamPadCoin coin = _launch(FeeMode.ToCreator, 0);
        vm.warp(vm.getBlockTimestamp() + 600);
        uint256 got = _extBuy(bob, address(coin), 200 * D);
        assertGt(got, 0, "bought from an outside app");
        uint256 back = _extSell(bob, address(coin), got / 2);
        assertGt(back, 0, "sold from an outside app");
        uint256 t0 = usdc.balanceOf(treasury);
        uint256 tc0 = coin.balanceOf(treasury);
        uint256 cc0 = coin.balanceOf(creator);
        (uint256 uf, uint256 cf) = builder.collectFees(address(coin));
        assertApproxEqRel(uf, 4 * D, 0.001e18, "2% of the 200 USDC buy");
        assertApproxEqRel(cf, (got / 2) * 2 / 100, 0.001e18, "2% of the coins sold");
        assertApproxEqAbs(usdc.balanceOf(treasury) - t0, uf - uf * 3000 / 10000, 1);
        assertApproxEqAbs(coin.balanceOf(treasury) - tc0, cf - cf * 3000 / 10000, 1);
        assertApproxEqAbs(coin.balanceOf(creator) - cc0, cf * 3000 / 10000, 1);
        // Collecting again right away finds nothing new.
        (uint256 uf2, uint256 cf2) = builder.collectFees(address(coin));
        assertEq(uf2 + cf2, 0);
    }

    /// The creator's launch buy is made by the builder and pays the normal 2%, not 10%.
    function _flow_launchBuyPaysBase() internal {
        uint256 c0 = usdc.balanceOf(creator);
        ArkhamPadCoin coin = _launch(FeeMode.ToCreator, 100 * D);
        uint256 got = coin.balanceOf(creator);
        assertEq(c0 - usdc.balanceOf(creator), 100 * D, "paid exactly the launch buy");
        assertApproxEqRel(got, _fresh(98 * D), 0.025e18, "2% fee, launch price");
        (uint256 uf,) = builder.collectFees(address(coin));
        assertApproxEqRel(uf, 2 * D, 0.001e18, "2% of 100");
        assertEq(usdc.balanceOf(address(builder)) - builder.usdcHeld(), 0, "builder keeps nothing");
    }

    /// Everyone can always sell back; selling everything brings the price back near the start.
    function _flow_sellBackAll() internal {
        ArkhamPadCoin coin = _launch(FeeMode.ToCreator, 0);
        vm.warp(vm.getBlockTimestamp() + 301);
        uint256 q0 = _quoteBuy(address(coin), 10 * D);
        uint256 a = _extBuy(alice, address(coin), 3_000 * D);
        uint256 b = _extBuy(bob, address(coin), 3_000 * D);
        uint256 backB = _extSell(bob, address(coin), b);
        uint256 backA = _extSell(alice, address(coin), a);
        assertGt(backA, backB, "earlier buyer made a profit vs later one");
        // round trip of both at 2% each way: they get back ~ (6000 - fees)
        assertApproxEqRel(backA + backB, 6_000 * D * 96 / 100, 0.02e18);
        uint256 again = _quoteBuy(address(coin), 10 * D);
        // Coin-side fees stay with the locked position, so the price ends a little above the start.
        assertLe(again, q0, "price never ends below the start");
        assertApproxEqRel(again, q0, 0.03e18, "close to the launch price");
    }

    /// Buyback & burn mode: the coin's 30% buys the coin back and burns it.
    function _flow_buybackBurn() internal {
        ArkhamPadCoin coin = _launch(FeeMode.BuybackBurn, 0);
        vm.warp(vm.getBlockTimestamp() + 301);
        _extBuy(alice, address(coin), 5_000 * D);
        uint256 funds0 = builder.buybackFunds(address(coin)); // from the launch buy's fee
        (uint256 uf,) = builder.collectFees(address(coin));
        assertEq(builder.buybackFunds(address(coin)) - funds0, uf * 3000 / 10000, "30% goes to buyback");
        uint256 toCoin = builder.buybackFunds(address(coin));
        uint256 burnBefore = coin.balanceOf(builder.BURN());
        (uint256 spent, uint256 burned) = builder.buyback(address(coin));
        assertEq(spent, toCoin > 100 * D ? 100 * D : toCoin);
        assertGt(burned, 0);
        assertEq(coin.balanceOf(builder.BURN()) - burnBefore, burned);
    }

    /// Nobody but the builder can open a pool with our hook, for any coin.
    function _flow_guardBlocksOtherPools() internal {
        ArkhamPadCoin coin = _launch(FeeMode.ToCreator, 0);
        PoolKey memory key = builder.poolKeyFor(address(coin));
        vm.expectRevert();
        pm.initialize(key, TickMath.getSqrtPriceAtTick(0)); // already open
        PoolKey memory other = PoolKey({currency0: key.currency0, currency1: key.currency1, fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: 60, hooks: IHooks(address(hook))});
        vm.prank(bob);
        vm.expectRevert();
        pm.initialize(other, TickMath.getSqrtPriceAtTick(0));
        // and the hook only answers the pool manager
        vm.expectRevert(PadLaunchHook.NotPoolManager.selector);
        hook.beforeInitialize(address(builder), key, 0);
    }

    /// Gasless: a user with only USDC launches, buys and sells through the router.
    function _flow_gasless() internal {
        uint256 pk = uint256(keccak256(abi.encode("arkhampad gasless test user", block.chainid)));
        address u = vm.addr(pk);
        assertEq(u.code.length, 0, "test user must be a plain wallet");
        address relayer = address(0x5E1A);
        _fund(u, 500 * D);
        _permitTo(address(usdc), pk, u);
        PadRouter.Launch memory l = PadRouter.Launch({name: "Gasless", symbol: "GSL", metadataURI: "", lockSeconds: 0, feeMode: FeeMode.ToCreator, launchUsdc: 10 * D, minCoinsOut: 0});
        uint256 dl = vm.getBlockTimestamp() + 3600;
        bytes32 sh = keccak256(abi.encode(router.CREATE_TYPEHASH(), u, keccak256(bytes(l.name)), keccak256(bytes(l.symbol)), keccak256(bytes(l.metadataURI)), l.lockSeconds, uint8(l.feeMode), l.launchUsdc, l.minCoinsOut, uint256(D / 100), uint256(1), dl));
        PadRouter.Sig memory s1 = PadRouter.Sig(dl, 1, _signR(pk, sh));
        vm.prank(relayer);
        address coin = router.launch(u, l, D / 100, s1);
        (,address cr,) = builder.pools(coin);
        assertEq(cr, u, "the user is the creator");
        uint256 held = IERC20(coin).balanceOf(u);
        assertGt(held, 0, "launch buy delivered");

        vm.warp(vm.getBlockTimestamp() + 301);
        uint256 q = router.quotePool(coin, true, 25 * D);
        bytes32 bh = keccak256(abi.encode(router.POOL_BUY_TYPEHASH(), u, coin, uint256(25 * D), q, uint256(D / 100), uint256(2), dl));
        PadRouter.Sig memory s2 = PadRouter.Sig(dl, 2, _signR(pk, bh));
        vm.prank(relayer);
        uint256 got = router.poolBuy(u, coin, 25 * D, q, D / 100, s2);
        assertEq(got, q, "got the quote");

        _permitTo(coin, pk, u);
        uint256 total = held + got;
        uint256 qs = router.quotePool(coin, false, total);
        bytes32 sl = keccak256(abi.encode(router.POOL_SELL_TYPEHASH(), u, coin, total, qs - D / 100, uint256(D / 100), uint256(3), dl));
        PadRouter.Sig memory s3 = PadRouter.Sig(dl, 3, _signR(pk, sl));
        uint256 before = usdc.balanceOf(u);
        vm.prank(relayer);
        router.poolSell(u, coin, total, qs - D / 100, D / 100, s3);
        assertGt(usdc.balanceOf(u), before, "got USDC back");
        assertEq(IERC20(coin).balanceOf(u), 0);
        assertEq(usdc.balanceOf(address(router)), 0, "router keeps no USDC");
        assertEq(IERC20(coin).balanceOf(address(router)), 0, "router keeps no coins");
        assertEq(usdc.balanceOf(relayer), 3 * D / 100, "relayer repaid in USDC");
        assertEq(u.balance, 0, "user never needed ETH");
    }

    /// Every launch needs a creator buy of at least $5: no free, empty launches.
    function _flow_minLaunchBuy() internal {
        vm.startPrank(creator);
        usdc.approve(address(hub), 100 * D);
        vm.expectRevert(abi.encodeWithSelector(PadHub.LaunchBuyTooSmall.selector, 5 * D));
        hub.createCoin("Free", "FREE", "", 0, FeeMode.ToCreator, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(PadHub.LaunchBuyTooSmall.selector, 5 * D));
        hub.createCoin("Cheap", "CHEAP", "", 0, FeeMode.ToCreator, 5 * D - 1, 0);
        address c = hub.createCoin("Fine", "FINE", "", 0, FeeMode.ToCreator, 5 * D, 0);
        vm.stopPrank();
        assertGt(IERC20(c).balanceOf(creator), 0);
    }

    /// Review hardening: a hub can't be deployed without a minimum first buy, and the
    /// fee for a time before the launch is the launch fee (no underflow).
    function _flow_hardening() internal {
        vm.expectRevert(abi.encodeWithSelector(PadHub.LaunchBuyTooSmall.selector, 0));
        new PadHub(usdc, builder, 4500 * D, 0, admin, treasury);
        assertEq(hook.feeAt(1000, 999), 100_000);
        assertEq(hook.feeAt(1000, 0), 100_000);
        assertGt(hook.feeAt(1000, 1119), 20_000, "still above 2% at 119s");
        assertEq(hook.feeAt(1000, 1120), 20_000);
    }

    /// The router only trades coins launched on ArkhamPad.
    function _flow_onlyOurCoins() internal {
        vm.expectRevert(PadRouter.NoPool.selector);
        router.quotePool(address(0xBEEF), true, 10 * D);
    }

    /// Only the pool manager, and only during our own unlock, can run the swap callbacks.
    function _flow_callbacksLocked() internal {
        ArkhamPadCoin coin = _launch(FeeMode.ToCreator, 0);
        bytes memory data = abi.encode(address(coin), true, uint256(1 * D), false);
        vm.expectRevert(PadRouter.OnlyPoolManager.selector);
        router.unlockCallback(data);
        vm.prank(address(pm));
        vm.expectRevert(PadRouter.NotUnlocking.selector);
        router.unlockCallback(data);
        vm.prank(address(pm));
        vm.expectRevert(PadPoolBuilder.NotUnlocking.selector);
        builder.unlockCallback(abi.encode(address(coin), uint256(1 * D), bob));
        // launchPool / launchBuy are hub-only
        vm.expectRevert(PadPoolBuilder.NotHub.selector);
        builder.launchPool(address(coin), 1, 1, bob, FeeMode.ToCreator);
        vm.expectRevert(PadPoolBuilder.NotHub.selector);
        builder.launchBuy(address(coin), 1, 0, bob);
    }

    /// The guardian can pause new launches; trading in existing pools never stops.
    function _flow_pause() internal {
        ArkhamPadCoin coin = _launch(FeeMode.ToCreator, 0);
        vm.prank(admin);
        hub.pauseBuys();
        vm.prank(creator);
        vm.expectRevert(PadHub.NotAllowed.selector);
        hub.createCoin("Nope", "NOPE", "", 0, FeeMode.ToCreator, 5 * D, 0);
        vm.warp(vm.getBlockTimestamp() + 301);
        assertGt(_extBuy(bob, address(coin), 10 * D), 0, "pool still trades");
    }

    /// The creator lock still holds: the creator can't sell during the lock, others can.
    function _flow_creatorLock() internal {
        vm.startPrank(creator);
        usdc.approve(address(hub), 50 * D);
        ArkhamPadCoin coin = ArkhamPadCoin(hub.createCoin("Locked", "LOCK", "", 3600, FeeMode.ToCreator, 50 * D, 0));
        vm.stopPrank();
        uint256 held = coin.balanceOf(creator);
        assertGt(held, 0);
        PoolKey memory key = builder.poolKeyFor(address(coin));
        bool sellDir = !builder.usdcIsCurrency0(address(coin));
        vm.startPrank(creator);
        coin.approve(address(swapper), type(uint256).max);
        vm.expectRevert();
        swapper.swap(key, sellDir, held);
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + 3601);
        assertGt(_extSell(creator, address(coin), held), 0, "free after the lock");
    }

    /// USDC sent to the builder by mistake is never used by a launch.
    function _flow_builderStrayUsdc() internal {
        _fund(bob, 100 * D);
        vm.prank(bob);
        usdc.transfer(address(builder), 100 * D);
        _launch(FeeMode.ToCreator, 20 * D);
        assertEq(usdc.balanceOf(address(builder)) - builder.usdcHeld(), 100 * D, "stray USDC untouched");
    }

    /// Tokens sent to the router by mistake can be returned by the admin only.
    function _flow_routerSweep() internal {
        _fund(bob, 100 * D);
        uint256 b0 = usdc.balanceOf(bob);
        vm.prank(bob);
        usdc.transfer(address(router), 100 * D);
        vm.prank(bob);
        vm.expectRevert(PadRouter.NotAdmin.selector);
        router.sweep(address(usdc), bob);
        vm.prank(admin);
        router.sweep(address(usdc), bob);
        assertEq(usdc.balanceOf(bob), b0);
    }

    function _signR(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", router.domainSeparator(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _permitTo(address token, uint256 pk, address owner) internal {
        (bool hasPermit,) = token.staticcall(abi.encodeWithSignature("nonces(address)", owner));
        if (!hasPermit) {
            vm.prank(owner);
            IERC20(token).approve(address(router), type(uint256).max);
            return;
        }
        bytes32 PERMIT = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        uint256 dl = vm.getBlockTimestamp() + 1 hours;
        bytes32 sh = keccak256(abi.encode(PERMIT, owner, address(router), type(uint256).max, IPermitView(token).nonces(owner), dl));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", IPermitView(token).DOMAIN_SEPARATOR(), sh)));
        IPermitCall(token).permit(owner, address(router), type(uint256).max, dl, v, r, s);
        assertEq(IERC20(token).allowance(owner, address(router)), type(uint256).max, "permit worked");
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
