// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PadClankerRoute} from "../src/PadClankerRoute.sol";
import {PadExtSwap} from "../src/PadExtSwap.sol";
import {MockUSDC} from "./Mocks.sol";

contract RouteCoin is ERC20 {
    constructor() ERC20("Clanker Coin", "CLK") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
    function deposit() external payable { _mint(msg.sender, msg.value); }
    function withdraw(uint256 a) external {
        _burn(msg.sender, a);
        (bool ok,) = msg.sender.call{value: a}("");
        require(ok, "eth");
    }
    receive() external payable { _mint(msg.sender, msg.value); }
}

/// Constant-product stand-in for a Uniswap/PancakeSwap v3 pool: pays out first, then calls back for
/// the input and checks it arrived (exactly like the real pools do).
contract MockV3Pool {
    address public token0;
    address public token1;
    bool pancake;
    constructor(address a, address b, bool pancake_) { (token0, token1) = a < b ? (a, b) : (b, a); pancake = pancake_; }
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data) external returns (int256 a0, int256 a1) {
        require(amountSpecified > 0, "exact in only");
        uint256 inAmt = uint256(amountSpecified);
        (address tin, address tout) = zeroForOne ? (token0, token1) : (token1, token0);
        uint256 rin = IERC20(tin).balanceOf(address(this));
        uint256 rout = IERC20(tout).balanceOf(address(this));
        uint256 out = (inAmt * 9999 * rout) / (rin * 10_000 + inAmt * 9999);
        IERC20(tout).transfer(recipient, out);
        (a0, a1) = zeroForOne ? (int256(inAmt), -int256(out)) : (-int256(out), int256(inAmt));
        if (pancake) IPancakeCb(msg.sender).pancakeV3SwapCallback(a0, a1, data);
        else IUniCb(msg.sender).uniswapV3SwapCallback(a0, a1, data);
        require(IERC20(tin).balanceOf(address(this)) >= rin + inAmt, "not paid");
    }
}
interface IUniCb { function uniswapV3SwapCallback(int256, int256, bytes calldata) external; }
interface IPancakeCb { function pancakeV3SwapCallback(int256, int256, bytes calldata) external; }

/// @notice ArkhamPad's own route into Clanker-style coin/WETH pools, against a fresh local Uniswap v4.
/// Covers both kinds of dollar pool (native ETH/USDC and WETH/USDC), quotes, refusals, and the
/// full gasless flow through PadExtSwap (signature, 1% fee, network fee, user's minimum).
abstract contract ClankerRouteBase is Test {
    IPoolManager pm;
    PoolModifyLiquidityTest lp;
    MockUSDC usdc;
    MockWETH weth;
    RouteCoin coin;
    PadClankerRoute route;
    PoolKey dollarKey;
    PoolKey coinKey;

    uint256 pk = 0xB0B;
    address user;
    address admin = address(0xA11CE);
    address treasury = address(0x7EA5);
    address relayer = address(0x5E1A);

    /// 0 = v4 native ETH/USDC, 1 = v4 WETH/USDC, 2 = Uniswap v3 WETH/USDC, 3 = PancakeSwap v3 WETH/USDC
    function _mode() internal pure virtual returns (uint8);
    function _native() internal pure returns (bool) { return _mode() == 0; }
    MockV3Pool v3;

    receive() external payable {} // the liquidity helper returns unused ETH

    function setUp() public {
        pm = IPoolManager(deployCode("out/PoolManager.sol/PoolManager.json", abi.encode(address(this))));
        lp = new PoolModifyLiquidityTest(pm);
        usdc = new MockUSDC();
        weth = new MockWETH();
        coin = new RouteCoin();
        user = vm.addr(pk);

        // ---- dollar pool: ETH at $3,000, fee 0.05%
        address eth = _native() ? address(0) : address(weth);
        (address d0, address d1) = eth < address(usdc) ? (eth, address(usdc)) : (address(usdc), eth);
        dollarKey = PoolKey(Currency.wrap(d0), Currency.wrap(d1), 500, 10, IHooks(address(0)));
        // raw price token1/token0: USDC per wei = 3e-9, or wei per USDC unit = 3.33e8
        int24 dTick = d0 == eth ? int24(-196260) : int24(196260);
        pm.initialize(dollarKey, TickMath.getSqrtPriceAtTick(dTick));
        _fundLp();
        lp.modifyLiquidity{value: _native() ? 100_000 ether : 0}(dollarKey, ModifyLiquidityParams(-887270, 887270, 1e18, 0), "");

        // ---- coin pool (like Clanker's): coin/WETH, 1% fee, spacing 200, 1 coin = 1e-8 ETH
        (address c0, address c1) = address(coin) < address(weth) ? (address(coin), address(weth)) : (address(weth), address(coin));
        coinKey = PoolKey(Currency.wrap(c0), Currency.wrap(c1), 10_000, 200, IHooks(address(0)));
        int24 cTick = c0 == address(weth) ? int24(184200) : int24(-184200);
        pm.initialize(coinKey, TickMath.getSqrtPriceAtTick(cTick));
        lp.modifyLiquidity(coinKey, ModifyLiquidityParams(-887200, 887200, 1e24, 0), ""); // about 100 ETH deep

        if (_mode() >= 2) {
            v3 = new MockV3Pool(address(usdc), address(weth), _mode() == 3);
            usdc.mint(address(v3), 30_000_000e6); // $3,000 per ETH, 10,000 ETH deep
            weth.mint(address(v3), 10_000 ether);
        }
        route = new PadClankerRoute(pm, address(usdc), address(weth), dollarKey, address(v3));
    }

    function _fundLp() internal {
        vm.deal(address(this), 1_000_000 ether);
        usdc.mint(address(this), 1e30);
        weth.mint(address(this), 1e30);
        coin.mint(address(this), 1e40);
        usdc.approve(address(lp), type(uint256).max);
        weth.approve(address(lp), type(uint256).max);
        coin.approve(address(lp), type(uint256).max);
    }

    function _routeHoldsNothing() internal view {
        assertEq(usdc.balanceOf(address(route)), 0, "route kept USDC");
        assertEq(weth.balanceOf(address(route)), 0, "route kept WETH");
        assertEq(coin.balanceOf(address(route)), 0, "route kept coins");
        assertEq(address(route).balance, 0, "route kept ETH");
    }

    // ------------------------------------------------------------------ the route on its own

    function test_buyThenSellBack() public {
        address me = address(0xCAFE);
        usdc.mint(me, 100e6);
        vm.startPrank(me);
        usdc.approve(address(route), 100e6);
        uint256 q = route.quote(true, address(coin), 100e6, coinKey);
        uint256 got = route.buy(address(coin), 100e6, coinKey);
        vm.stopPrank();
        assertEq(got, q, "quote != buy");
        assertEq(coin.balanceOf(me), got);
        assertEq(usdc.balanceOf(me), 0);
        // $100 at 1e-8 ETH/coin and $3,000/ETH is about 3.33M coins, less two pool fees (0.05% + 1%)
        assertGt(got, 3.25e6 * 1e18);
        assertLt(got, 3.34e6 * 1e18);
        _routeHoldsNothing();

        vm.startPrank(me);
        coin.approve(address(route), got);
        uint256 q2 = route.quote(false, address(coin), got, coinKey);
        uint256 back = route.sell(address(coin), got, coinKey);
        vm.stopPrank();
        assertEq(back, q2, "quote != sell");
        assertEq(usdc.balanceOf(me), back);
        assertEq(coin.balanceOf(me), 0);
        // round trip loses about 2 x (0.05% + 1%) plus a little price impact
        assertGt(back, 97.5e6);
        assertLt(back, 100e6);
        _routeHoldsNothing();
    }

    /// The round-trip quote matches a real buy followed by a real sale.
    function test_roundTripMatchesRealTrades() public {
        address me = address(0xCAFE);
        usdc.mint(me, 100e6);
        (uint256 qc, uint256 qb) = route.quoteRoundTrip(address(coin), 100e6, coinKey);
        vm.startPrank(me);
        usdc.approve(address(route), 100e6);
        uint256 got = route.buy(address(coin), 100e6, coinKey);
        coin.approve(address(route), got);
        uint256 back = route.sell(address(coin), got, coinKey);
        vm.stopPrank();
        assertEq(qc, got, "round trip: coins");
        if (_mode() < 2) assertEq(qb, back, "round trip: dollars back");
        else assertApproxEqRel(qb, back, 0.001e18, "round trip: dollars back (v3 hops quoted on today's pool)");
        _routeHoldsNothing();
    }

    /// A Clanker-style pool at its starting price holds only coins: a sale quoted on its own returns
    /// almost nothing, but buying and selling straight back works. The round-trip quote shows it.
    function test_startingPricePool() public {
        RouteCoin fresh = new RouteCoin();
        fresh.mint(address(this), 1e40);
        fresh.approve(address(lp), type(uint256).max);
        bool coinIs0 = address(fresh) < address(weth);
        PoolKey memory k = PoolKey(Currency.wrap(coinIs0 ? address(fresh) : address(weth)), Currency.wrap(coinIs0 ? address(weth) : address(fresh)), 10_000, 200, IHooks(address(0)));
        int24 t = coinIs0 ? int24(-184200) : int24(184200);
        pm.initialize(k, TickMath.getSqrtPriceAtTick(t));
        // all coins, no ETH: coin = token0 -> range above the price; coin = token1 -> range below it
        ModifyLiquidityParams memory p = coinIs0 ? ModifyLiquidityParams(t, t + 40_000, 1e24, 0) : ModifyLiquidityParams(t - 40_000, t, 1e24, 0);
        lp.modifyLiquidity(k, p, "");
        (uint256 qc, uint256 qb) = route.quoteRoundTrip(address(fresh), 10e6, k);
        assertGt(qc, 0);
        // a sale quoted on its own: the pool has no ETH to pay (reverts NoOutput, or returns dust)
        uint256 alone;
        try route.quote(false, address(fresh), qc, k) returns (uint256 x) { alone = x; } catch { alone = 0; }
        assertLt(alone, 1e6, "a sale on its own finds no ETH");
        assertGt(qb, 9.5e6, "buy then sell back returns most of it");
        // and real trades do the same
        address me = address(0xBEEF);
        usdc.mint(me, 10e6);
        vm.startPrank(me);
        usdc.approve(address(route), 10e6);
        uint256 got = route.buy(address(fresh), 10e6, k);
        fresh.approve(address(route), got);
        uint256 back = route.sell(address(fresh), got, k);
        vm.stopPrank();
        assertEq(got, qc);
        if (_mode() < 2) assertEq(back, qb);
        else assertApproxEqRel(back, qb, 0.001e18);
    }

    function test_refusesWrongPools() public {
        address me = address(0xCAFE);
        usdc.mint(me, 10e6);
        vm.startPrank(me);
        usdc.approve(address(route), 10e6);
        // a pool that isn't coin/WETH
        PoolKey memory bad = PoolKey(Currency.wrap(address(coin) < address(usdc) ? address(coin) : address(usdc)), Currency.wrap(address(coin) < address(usdc) ? address(usdc) : address(coin)), 10_000, 200, IHooks(address(0)));
        vm.expectRevert(PadClankerRoute.BadCoinPool.selector);
        route.buy(address(coin), 10e6, bad);
        // the coin can't be WETH or USDC
        vm.expectRevert(PadClankerRoute.BadCoinPool.selector);
        route.buy(address(weth), 10e6, coinKey);
        // zero
        vm.expectRevert(PadClankerRoute.ZeroAmount.selector);
        route.buy(address(coin), 0, coinKey);
        vm.stopPrank();
    }

    function test_onlyPoolManagerCallsBack() public {
        vm.expectRevert(PadClankerRoute.NotPoolManager.selector);
        route.unlockCallback("");
        // nobody can ask the route to pay as if it were the v3 pool (not even the pool, outside a swap)
        vm.expectRevert(PadClankerRoute.NotDollarPool.selector);
        route.uniswapV3SwapCallback(1e6, -1, "");
        vm.expectRevert(PadClankerRoute.NotDollarPool.selector);
        route.pancakeV3SwapCallback(1e6, -1, "");
        if (address(v3) != address(0)) {
            vm.prank(address(v3));
            vm.expectRevert(PadClankerRoute.NotDollarPool.selector);
            route.uniswapV3SwapCallback(1e6, -1, "");
        }
        vm.expectRevert(PadClankerRoute.NotSelf.selector);
        route.quoteInner(true, false, address(coin), 1e6, coinKey);
        vm.expectRevert(PadClankerRoute.NotSelf.selector);
        route.v3QuoteInner(true, 1e6);
        vm.expectRevert(PadClankerRoute.NotSelf.selector);
        route.roundInner(false, address(coin), 1e6, coinKey);
    }

    function test_badDollarPoolRefused() public {
        PoolKey memory k = PoolKey(Currency.wrap(address(coin) < address(weth) ? address(coin) : address(weth)), Currency.wrap(address(coin) < address(weth) ? address(weth) : address(coin)), 500, 10, IHooks(address(0)));
        vm.expectRevert(PadClankerRoute.BadDollarPool.selector);
        new PadClankerRoute(pm, address(usdc), address(weth), k, address(0));
        // a v3 pool that isn't USDC/WETH
        MockV3Pool wrong = new MockV3Pool(address(coin), address(weth), false);
        vm.expectRevert(PadClankerRoute.BadDollarPool.selector);
        new PadClankerRoute(pm, address(usdc), address(weth), dollarKey, address(wrong));
    }

    /// Any size from $1 to $20K: the buy matches its quote, everything sells back, nothing stays behind.
    function testFuzz_roundTrip(uint64 raw) public {
        uint256 amount = bound(uint256(raw), 1e6, 20_000e6);
        address me = address(0xF00D);
        usdc.mint(me, amount);
        vm.startPrank(me);
        usdc.approve(address(route), amount);
        uint256 q = route.quote(true, address(coin), amount, coinKey);
        uint256 got = route.buy(address(coin), amount, coinKey);
        assertEq(got, q);
        coin.approve(address(route), got);
        uint256 back = route.sell(address(coin), got, coinKey);
        vm.stopPrank();
        assertLe(back, amount);
        assertGt(back, (amount * 95) / 100);
        _routeHoldsNothing();
    }

    // ------------------------------------------------------------------ the real flow: PadExtSwap + route

    function _sign(PadExtSwap sw, PadExtSwap.Swap memory s) internal view returns (PadExtSwap.Swap memory) {
        bytes32 h = keccak256(abi.encode(sw.EXT_SWAP_TYPEHASH(), s.user, s.isBuy, s.coin, s.amountIn, s.minOut, s.target, keccak256(s.data), s.fee, s.nonce, s.deadline));
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", sw.domainSeparator(), h)));
        s.signature = abi.encodePacked(r, ss, v);
        return s;
    }

    function test_gaslessThroughPadExtSwap() public {
        PadExtSwap sw = new PadExtSwap(IERC20(address(usdc)), admin, treasury);
        vm.prank(admin);
        sw.setTarget(address(route), true);
        usdc.mint(user, 100e6 + 0.05e6);
        vm.startPrank(user);
        usdc.approve(address(sw), type(uint256).max);
        coin.approve(address(sw), type(uint256).max);
        vm.stopPrank();

        // BUY $100: PadExtSwap keeps 1% and swaps the rest through the route
        uint256 amountIn = 100e6;
        uint256 spend = amountIn - (amountIn * 100) / 10_000;
        uint256 q = route.quote(true, address(coin), spend, coinKey);
        bytes memory data = abi.encodeCall(PadClankerRoute.buy, (address(coin), spend, coinKey));
        PadExtSwap.Swap memory s = _sign(sw, PadExtSwap.Swap(user, true, address(coin), amountIn, (q * 98) / 100, address(route), data, 0.05e6, 1, block.timestamp + 60, ""));
        vm.prank(relayer);
        uint256 out = sw.swap(s);
        assertEq(out, q);
        assertEq(coin.balanceOf(user), q);
        assertEq(usdc.balanceOf(user), 0);
        assertEq(usdc.balanceOf(treasury), 1e6, "1% fee");
        assertEq(usdc.balanceOf(relayer), 0.05e6, "network fee");
        _routeHoldsNothing();
        assertEq(usdc.balanceOf(address(sw)), 0);
        assertEq(coin.balanceOf(address(sw)), 0);

        // SELL everything back
        uint256 coins = coin.balanceOf(user);
        uint256 qs = route.quote(false, address(coin), coins, coinKey);
        uint256 fee = 0.05e6;
        uint256 expect = qs - (qs * 100) / 10_000 - fee;
        bytes memory data2 = abi.encodeCall(PadClankerRoute.sell, (address(coin), coins, coinKey));
        PadExtSwap.Swap memory s2 = _sign(sw, PadExtSwap.Swap(user, false, address(coin), coins, (expect * 98) / 100, address(route), data2, fee, 2, block.timestamp + 60, ""));
        vm.prank(relayer);
        uint256 out2 = sw.swap(s2);
        assertEq(out2, expect);
        assertEq(usdc.balanceOf(user), expect);
        assertEq(coin.balanceOf(user), 0);
        _routeHoldsNothing();
        assertEq(usdc.balanceOf(address(sw)), 0);
        assertEq(coin.balanceOf(address(sw)), 0);
    }

    function test_userMinimumHolds() public {
        PadExtSwap sw = new PadExtSwap(IERC20(address(usdc)), admin, treasury);
        vm.prank(admin);
        sw.setTarget(address(route), true);
        usdc.mint(user, 101e6);
        vm.prank(user);
        usdc.approve(address(sw), type(uint256).max);
        uint256 spend = 99e6;
        uint256 q = route.quote(true, address(coin), spend, coinKey);
        bytes memory data = abi.encodeCall(PadClankerRoute.buy, (address(coin), spend, coinKey));
        // asks for more than the pool gives: the whole trade reverts, the user keeps their dollars
        PadExtSwap.Swap memory s = _sign(sw, PadExtSwap.Swap(user, true, address(coin), 100e6, q + 1, address(route), data, 0, 1, block.timestamp + 60, ""));
        vm.prank(relayer);
        vm.expectRevert();
        sw.swap(s);
        assertEq(usdc.balanceOf(user), 101e6);
        assertEq(coin.balanceOf(user), 0);
    }
}

contract ClankerRouteNativeTest is ClankerRouteBase {
    function _mode() internal pure override returns (uint8) { return 0; }
}

contract ClankerRouteWrappedTest is ClankerRouteBase {
    function _mode() internal pure override returns (uint8) { return 1; }
}

contract ClankerRouteV3Test is ClankerRouteBase {
    function _mode() internal pure override returns (uint8) { return 2; }
}

contract ClankerRoutePancakeV3Test is ClankerRouteBase {
    function _mode() internal pure override returns (uint8) { return 3; }
}
