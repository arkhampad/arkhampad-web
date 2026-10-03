// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
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

    function _quoteOut(PoolKey memory key, bool zeroForOne, uint256 amountIn) internal returns (uint256 out) {
        uint256 snap = vm.snapshotState();
        vm.startPrank(bob);
        usdc.approve(address(swapper), type(uint256).max);
        out = swapper.swap(key, zeroForOne, amountIn);
        vm.stopPrank();
        vm.revertToState(snap);
    }
}

interface IERC721Like {
    function ownerOf(uint256) external view returns (address);
}
