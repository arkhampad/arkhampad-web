// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ArkhamV3Launcher, IV3PositionManager, IWrappedNative} from "../src/ArkhamV3Launcher.sol";
import {ArkhamRouter, PoolKey, IPoolManager} from "../src/ArkhamRouter.sol";
import {MockWrapped} from "./ArkhamV3Launcher.t.sol";
import {RouterProbe} from "./RouterProbe.sol";

contract TestToken is ERC20 {
    constructor() ERC20("Other Pad Coin", "OPC") {
        _mint(msg.sender, 1_000_000_000 ether);
    }
}

struct ModifyLiquidityParams {
    int24 tickLower;
    int24 tickUpper;
    int256 liquidityDelta;
    bytes32 salt;
}

interface IPM {
    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24);
    function unlock(bytes calldata) external returns (bytes memory);
    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params, bytes calldata hookData)
        external
        returns (int256, int256);
    function sync(address) external;
    function settle() external payable returns (uint256);
}

/// Adds full-range liquidity to a v4 pool (stands in for another launchpad).
contract LiqHelper {
    IPM pm;

    constructor(IPM pm_) {
        pm = pm_;
    }

    function add(PoolKey memory key, int256 liq) external payable {
        pm.unlock(abi.encode(key, liq));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (PoolKey memory key, int256 liq) = abi.decode(data, (PoolKey, int256));
        (int256 delta,) = pm.modifyLiquidity(key, ModifyLiquidityParams(-887200, 887200, liq, 0), "");
        int128 d0 = int128(delta >> 128);
        int128 d1 = int128(delta);
        _settle(key.currency0, uint256(uint128(-d0)));
        _settle(key.currency1, uint256(uint128(-d1)));
        return "";
    }

    function _settle(address c, uint256 amt) private {
        if (c == address(0)) {
            pm.settle{value: amt}();
        } else {
            pm.sync(c);
            IERC20(c).transfer(address(pm), amt);
            pm.settle();
        }
    }

    receive() external payable {}
}

/// A fake "pool" that tries to pull a victim's tokens through the router's callbacks.
contract EvilPool {
    ArkhamRouter r;
    address victim;
    address token;

    constructor(ArkhamRouter r_, address victim_, address token_) {
        r = r_;
        victim = victim_;
        token = token_;
    }

    function factory() external pure returns (address) {
        return address(0);
    }

    function swap(address, bool, int256, uint160, bytes calldata) external returns (int256, int256) {
        // claim the victim is the payer and that we are owed their whole balance
        uint256 amt = IERC20(token).balanceOf(victim);
        r.uniswapV3SwapCallback(int256(amt), 0, abi.encode(uint8(2), true, false, victim, token, amt));
        return (int256(amt), 0);
    }
}

contract ArkhamRouterTest is Test {
    address owner = address(0xA11CE);
    address treasury = address(0x7EA5);
    address creator = address(0xC0FFEE);
    address trader = address(0xBEEF);
    address victim = address(0xD00D);

    MockWrapped whype;
    address factory;
    address npm;
    ArkhamV3Launcher launcher;
    // a second, unrelated v3 deployment: "another launchpad"
    address factory2;
    address npm2;
    ArkhamV3Launcher launcher2;
    ArkhamRouter router;
    IPM pm;
    LiqHelper liq;

    function setUp() public {
        address whypeAt = address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF);
        deployCodeTo("ArkhamV3Launcher.t.sol:MockWrapped", whypeAt);
        whype = MockWrapped(payable(whypeAt));
        factory = deployCode("v3/UniswapV3Factory.json");
        npm = deployCode("v3/NonfungiblePositionManager.json", abi.encode(factory, whypeAt, address(0)));
        launcher = new ArkhamV3Launcher(owner, IV3PositionManager(npm), IWrappedNative(whypeAt), 10_000, 200, treasury, 100 ether, 3_000);
        factory2 = deployCode("v3/UniswapV3Factory.json");
        npm2 = deployCode("v3/NonfungiblePositionManager.json", abi.encode(factory2, whypeAt, address(0)));
        launcher2 = new ArkhamV3Launcher(owner, IV3PositionManager(npm2), IWrappedNative(whypeAt), 10_000, 200, treasury, 100 ether, 3_000);
        router = new ArkhamRouter(owner, treasury, 50, factory);
        pm = IPM(deployCode("v4/PoolManager.json", abi.encode(owner)));
        liq = new LiqHelper(pm);
        vm.deal(creator, 1_000 ether);
        vm.deal(trader, 1_000 ether);
        vm.deal(address(liq), 1_000 ether);
    }

    function _v3(ArkhamV3Launcher l) internal returns (ArkhamRouter.Pool memory p) {
        vm.prank(creator);
        (address coin,) = l.launch{value: 1 ether}("Elysium Cat", "ECAT", "https://arkhampad.com/s/x", address(0), 0);
        (, address pool,,,) = l.coins(coin);
        p = ArkhamRouter.Pool(3, pool, coin, address(whype), coin < address(whype), 10_000, 200, address(0));
    }

    function _v4(bool native) internal returns (ArkhamRouter.Pool memory p) {
        TestToken t = new TestToken();
        address hype = native ? address(0) : address(whype);
        bool tokenIs0 = address(t) < hype;
        PoolKey memory key = tokenIs0
            ? PoolKey(address(t), hype, 10_000, 200, address(0))
            : PoolKey(hype, address(t), 10_000, 200, address(0));
        // 1 HYPE = 1,000,000 tokens
        uint160 sqrtP = tokenIs0 ? uint160((uint256(1) << 96) / 1000) : uint160(uint256(1000) << 96);
        pm.initialize(key, sqrtP);
        t.transfer(address(liq), 500_000_000 ether);
        if (!native) {
            vm.prank(address(liq));
            whype.deposit{value: 600 ether}();
        }
        liq.add(key, 10_000 ether);
        p = ArkhamRouter.Pool(4, address(pm), address(t), hype, tokenIs0, 10_000, 200, address(0));
    }

    function _roundTrip(ArkhamRouter.Pool memory p, uint16 expectFeeBps) internal {
        uint256 tBefore = treasury.balance;
        uint256 q = router.quote(p, true, 2 ether);
        assertGt(q, 0);
        vm.prank(trader);
        uint256 got = router.buy{value: 2 ether}(p, (q * 99) / 100, block.timestamp);
        assertEq(got, q, "buy matches quote");
        assertEq(IERC20(p.token).balanceOf(trader), got);
        assertEq(treasury.balance - tBefore, (2 ether * uint256(expectFeeBps)) / 10_000);

        uint256 qs = router.quote(p, false, got);
        vm.startPrank(trader);
        IERC20(p.token).approve(address(router), got);
        uint256 hBefore = trader.balance;
        uint256 back = router.sell(p, got, (qs * 99) / 100, block.timestamp);
        vm.stopPrank();
        assertEq(back, qs, "sell matches quote");
        assertEq(trader.balance - hBefore, back);
        assertGt(back, 1.9 ether); // fees + price impact stay small
        assertLt(back, 2 ether);
        // router keeps nothing
        assertEq(address(router).balance, 0);
        assertEq(whype.balanceOf(address(router)), 0);
        assertEq(IERC20(p.token).balanceOf(address(router)), 0);
    }

    function test_v3OwnPool_noRouterFee() public {
        _roundTrip(_v3(launcher), 0);
    }

    function test_v3OtherLaunchpad_routerFee() public {
        _roundTrip(_v3(launcher2), 50);
    }

    function test_v4NativePool() public {
        _roundTrip(_v4(true), 50);
    }

    function test_v4WrappedPool() public {
        _roundTrip(_v4(false), 50);
    }

    function test_slippageAndDeadline() public {
        ArkhamRouter.Pool memory p = _v3(launcher2);
        uint256 q = router.quote(p, true, 1 ether);
        vm.prank(trader);
        vm.expectRevert();
        router.buy{value: 1 ether}(p, q + 1, block.timestamp);
        vm.prank(trader);
        vm.expectRevert(ArkhamRouter.Expired.selector);
        router.buy{value: 1 ether}(p, 0, block.timestamp - 1);
    }

    function test_callbackOnlyFromActivePool() public {
        vm.expectRevert(ArkhamRouter.BadCaller.selector);
        router.uniswapV3SwapCallback(1, 0, abi.encode(uint8(2), true, false, victim, address(whype), 1));
        vm.expectRevert(ArkhamRouter.BadCaller.selector);
        router.unlockCallback("");
    }

    function test_evilPoolCannotTakeOthersTokens() public {
        ArkhamRouter.Pool memory p = _v3(launcher);
        // victim holds coins and approved the router
        vm.prank(trader);
        router.buy{value: 1 ether}(p, 0, block.timestamp);
        uint256 bal = IERC20(p.token).balanceOf(trader);
        vm.prank(trader);
        IERC20(p.token).transfer(victim, bal);
        vm.prank(victim);
        IERC20(p.token).approve(address(router), type(uint256).max);
        // attacker routes a sell through their own fake pool, naming the victim inside the callback
        EvilPool evil = new EvilPool(router, victim, p.token);
        ArkhamRouter.Pool memory e = ArkhamRouter.Pool(3, address(evil), p.token, address(whype), true, 10_000, 200, address(0));
        address attacker = address(0xBAD);
        vm.prank(attacker);
        vm.expectRevert();
        router.sell(e, 1, 0, block.timestamp);
        assertEq(IERC20(p.token).balanceOf(victim), bal);
    }

    function test_adminOnly() public {
        vm.expectRevert(ArkhamRouter.NotOwner.selector);
        router.setSettings(treasury, 10, factory);
        vm.prank(owner);
        vm.expectRevert(bytes("settings"));
        router.setSettings(treasury, 101, factory);
        vm.prank(owner);
        router.setSettings(treasury, 30, factory);
        assertEq(router.feeBps(), 30);
    }
}

contract RouterProbeTest is ArkhamRouterTest {
    function test_probeRoundTrip() public {
        ArkhamRouter.Pool memory p = _v4(true);
        address probe = address(new RouterProbe());
        vm.deal(probe, 0);
        (bool ok, bytes memory ret) = probe.call{value: 1 ether}(abi.encodeCall(RouterProbe.run, (router, p)));
        assertTrue(ok);
        (uint8 stage, uint256 qb, uint256 bought, uint256 qs, uint256 back,) = abi.decode(ret, (uint8, uint256, uint256, uint256, uint256, bytes));
        assertEq(stage, 5);
        assertEq(qb, bought);
        assertEq(qs, back);
    }
}
