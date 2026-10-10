// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";

interface IWETH9Like {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @dev Uniswap v3 and PancakeSwap v3 pools share this swap function.
interface IV3PoolLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// @title PadClankerRoute
/// @notice ArkhamPad's own route into Clanker coins' Uniswap v4 pools, for PadExtSwap (an allowlisted
/// "target"). DEX aggregators often can't see new Clanker pools; this route needs no aggregator:
///
///   buy:  USDC --(fixed deep dollar pool)--> ETH/BNB --(the coin's own Clanker pool)--> coin
///   sell: coin --(the coin's own Clanker pool)--> ETH/BNB --(fixed deep dollar pool)--> USDC
///
/// The dollar pool is fixed when the route is deployed: a Uniswap v4 pool (USDC with native ETH or
/// WETH), or a Uniswap/PancakeSwap v3 pool (USDC/WETH) where v4 is shallow (BNB Chain). The coin's
/// pool must be a coin/WETH v4 pool. The caller (PadExtSwap) approves exactly the input; the output
/// goes back to the caller. The route never keeps anything: no owner, no settings, no balance between
/// calls. Every amount settled is the amount the pools report. PadExtSwap checks the user's minimum.
///
/// quote(): the same swaps run and revert with the result (call it with eth_call).
contract PadClankerRoute is IUnlockCallback, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using TransientStateLibrary for IPoolManager;

    IPoolManager public immutable poolManager;
    address public immutable usdc;
    address public immutable weth;
    // the dollar pool: either a v4 pool (its key's fields) ...
    address public immutable dollarC0;
    address public immutable dollarC1;
    uint24 public immutable dollarFee;
    int24 public immutable dollarTickSpacing;
    address public immutable dollarHooks;
    bool public immutable dollarNative; // the v4 pool holds native ETH (address 0), not WETH
    // ... or a v3 pool (Uniswap v3 / PancakeSwap v3)
    address public immutable dollarV3;
    bool public immutable v3UsdcIs0;

    uint8 private constant BUY = 1;
    uint8 private constant SELL = 2;
    // transient flags: the v3 pool may call back only while this route is swapping in it
    bytes32 private constant V3_ACTIVE = keccak256("PadClankerRoute.v3.active");
    bytes32 private constant V3_QUOTE = keccak256("PadClankerRoute.v3.quote");

    event Routed(address indexed caller, address indexed coin, bool isBuy, uint256 amountIn, uint256 amountOut);

    error NotPoolManager();
    error NotDollarPool();
    error BadDollarPool();
    error BadCoinPool();
    error ZeroAmount();
    error NoOutput();
    error QuoteResult(uint256 amountOut);
    error NotSelf();
    error Unsettled();

    struct Job {
        uint8 side;
        bool quote;
        bool coinOnly; // v3 dollar pool: only the coin's v4 hop runs inside the unlock
        address coin;
        uint256 amountIn;
        address to;
        PoolKey coinKey;
    }

    /// @param dollarKey the v4 dollar pool (ignored when dollarV3_ is set)
    /// @param dollarV3_ a v3 USDC/WETH pool, or address(0) to use dollarKey
    constructor(IPoolManager pm, address usdc_, address weth_, PoolKey memory dollarKey, address dollarV3_) {
        if (address(pm) == address(0) || usdc_ == address(0) || weth_ == address(0)) revert BadDollarPool();
        poolManager = pm;
        usdc = usdc_;
        weth = weth_;
        if (dollarV3_ != address(0)) {
            address t0 = IV3PoolLike(dollarV3_).token0();
            address t1 = IV3PoolLike(dollarV3_).token1();
            if (!((t0 == usdc_ && t1 == weth_) || (t0 == weth_ && t1 == usdc_))) revert BadDollarPool();
            dollarV3 = dollarV3_;
            v3UsdcIs0 = t0 == usdc_;
        } else {
            address c0 = Currency.unwrap(dollarKey.currency0);
            address c1 = Currency.unwrap(dollarKey.currency1);
            bool native = c0 == address(0) && c1 == usdc_;
            bool wrapped = (c0 == usdc_ && c1 == weth_) || (c0 == weth_ && c1 == usdc_);
            if (!(native || wrapped)) revert BadDollarPool();
            dollarC0 = c0;
            dollarC1 = c1;
            dollarFee = dollarKey.fee;
            dollarTickSpacing = dollarKey.tickSpacing;
            dollarHooks = address(dollarKey.hooks);
            dollarNative = native;
        }
    }

    /// @notice WETH unwrapping and PoolManager.take of native ETH send ETH here.
    receive() external payable {}

    // ------------------------------------------------------------------ trades

    /// @notice USDC -> coin. Pulls `usdcIn` from the caller, sends the coins to the caller.
    function buy(address coin, uint256 usdcIn, PoolKey calldata coinKey) external nonReentrant returns (uint256 coinsOut) {
        _checkCoinKey(coin, coinKey);
        if (usdcIn == 0) revert ZeroAmount();
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), usdcIn);
        if (dollarV3 == address(0)) {
            coinsOut = abi.decode(poolManager.unlock(abi.encode(Job(BUY, false, false, coin, usdcIn, msg.sender, coinKey))), (uint256));
        } else {
            uint256 eth = _v3Swap(true, usdcIn, address(this));
            coinsOut = abi.decode(poolManager.unlock(abi.encode(Job(BUY, false, true, coin, eth, msg.sender, coinKey))), (uint256));
            _refund(usdc, msg.sender); // any USDC the v3 pool didn't use
        }
        if (coinsOut == 0) revert NoOutput();
        emit Routed(msg.sender, coin, true, usdcIn, coinsOut);
    }

    /// @notice coin -> USDC. Pulls `coinsIn` from the caller, sends the USDC to the caller.
    function sell(address coin, uint256 coinsIn, PoolKey calldata coinKey) external nonReentrant returns (uint256 usdcOut) {
        _checkCoinKey(coin, coinKey);
        if (coinsIn == 0) revert ZeroAmount();
        uint256 before = IERC20(coin).balanceOf(address(this));
        IERC20(coin).safeTransferFrom(msg.sender, address(this), coinsIn);
        uint256 received = IERC20(coin).balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();
        if (dollarV3 == address(0)) {
            usdcOut = abi.decode(poolManager.unlock(abi.encode(Job(SELL, false, false, coin, received, msg.sender, coinKey))), (uint256));
        } else {
            // the coin's pool pays WETH to this route; the v3 pool turns it into USDC for the caller
            uint256 eth = abi.decode(poolManager.unlock(abi.encode(Job(SELL, false, true, coin, received, address(this), coinKey))), (uint256));
            usdcOut = _v3Swap(false, eth, msg.sender);
            _refund(coin, msg.sender); // any coins the pool didn't use
            _refund(weth, msg.sender); // none expected
        }
        if (usdcOut == 0) revert NoOutput();
        emit Routed(msg.sender, coin, false, coinsIn, usdcOut);
    }

    /// @notice What buy (isBuy) or sell would give right now. Not a view: call it with eth_call.
    function quote(bool isBuy, address coin, uint256 amountIn, PoolKey calldata coinKey) external returns (uint256 amountOut) {
        _checkCoinKey(coin, coinKey);
        if (amountIn == 0) revert ZeroAmount();
        if (dollarV3 == address(0)) return _catchQuote(abi.encodeCall(this.quoteInner, (isBuy, false, coin, amountIn, coinKey)));
        if (isBuy) {
            uint256 eth = _catchQuote(abi.encodeCall(this.v3QuoteInner, (true, amountIn)));
            return _catchQuote(abi.encodeCall(this.quoteInner, (true, true, coin, eth, coinKey)));
        }
        uint256 e = _catchQuote(abi.encodeCall(this.quoteInner, (false, true, coin, amountIn, coinKey)));
        return _catchQuote(abi.encodeCall(this.v3QuoteInner, (false, e)));
    }

    /// @dev Only for quote(): runs the v4 swaps and reverts with the output.
    function quoteInner(bool isBuy, bool coinOnly, address coin, uint256 amountIn, PoolKey calldata coinKey) external {
        if (msg.sender != address(this)) revert NotSelf();
        poolManager.unlock(abi.encode(Job(isBuy ? BUY : SELL, true, coinOnly, coin, amountIn, address(0), coinKey)));
    }

    /// @dev Only for quote(): runs the v3 swap and reverts with the output.
    function v3QuoteInner(bool usdcIn, uint256 amountIn) external {
        if (msg.sender != address(this)) revert NotSelf();
        _tstore(V3_QUOTE, 1);
        _v3Swap(usdcIn, amountIn, address(this));
    }

    function _catchQuote(bytes memory call) private returns (uint256 out) {
        (bool ok, bytes memory r) = address(this).call(call);
        if (ok) revert NoOutput(); // the inner calls always revert
        if (r.length == 36 && bytes4(r) == QuoteResult.selector) {
            assembly { out := mload(add(r, 36)) }
        } else {
            assembly { revert(add(r, 32), mload(r)) }
        }
    }

    // ------------------------------------------------------------------ inside the v4 unlock

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        Job memory j = abi.decode(raw, (Job));
        bool coinIs0 = Currency.unwrap(j.coinKey.currency0) == j.coin;
        uint256 out;
        if (j.side == BUY) {
            uint256 eth = j.amountIn; // v3 dollar pool: the WETH is already here
            if (!j.coinOnly) {
                // 1. USDC -> ETH in the v4 dollar pool
                eth = _swapIn(_dollarKey(), dollarC0 == usdc, j.amountIn);
                // the dollar pool paid native ETH; the coin's pool takes WETH
                if (dollarNative && !j.quote) {
                    poolManager.take(Currency.wrap(address(0)), address(this), eth);
                    IWETH9Like(weth).deposit{value: eth}();
                }
            }
            // 2. WETH -> coin in the coin's pool
            out = _swapIn(j.coinKey, !coinIs0, eth);
            if (j.quote) revert QuoteResult(out);
            if (!j.coinOnly) _payOwed(usdc);
            _payOwed(weth);
            out = _takeAll(j.coin, j.to);
            if (!j.coinOnly) _refund(usdc, j.to); // any USDC the pools didn't use
        } else {
            // 1. coin -> WETH in the coin's pool
            uint256 eth = _swapIn(j.coinKey, coinIs0, j.amountIn);
            if (j.coinOnly) {
                if (j.quote) revert QuoteResult(eth);
                _payOwed(j.coin);
                out = _takeAll(weth, j.to); // to this route, for the v3 hop
            } else {
                if (dollarNative && !j.quote) {
                    poolManager.take(Currency.wrap(weth), address(this), eth);
                    IWETH9Like(weth).withdraw(eth);
                }
                // 2. ETH -> USDC in the v4 dollar pool
                out = _swapIn(_dollarKey(), dollarC0 != usdc, eth);
                if (j.quote) revert QuoteResult(out);
                if (dollarNative) {
                    int256 d = poolManager.currencyDelta(address(this), Currency.wrap(address(0)));
                    if (d < 0) {
                        poolManager.sync(Currency.wrap(address(0)));
                        poolManager.settle{value: uint256(-d)}();
                    }
                }
                _payOwed(j.coin);
                _payOwed(weth);
                out = _takeAll(usdc, j.to);
                _refund(j.coin, j.to); // any coins the pool didn't use
            }
        }
        // nothing may be left open (the PoolManager also enforces it)
        if (
            poolManager.currencyDelta(address(this), Currency.wrap(weth)) != 0
                || poolManager.currencyDelta(address(this), Currency.wrap(address(0))) != 0
        ) revert Unsettled();
        // native ETH left from wrapping/unwrapping (none expected) goes back as WETH
        if (address(this).balance > 0) IWETH9Like(weth).deposit{value: address(this).balance}();
        _refund(weth, j.to);
        return abi.encode(out);
    }

    /// @dev Exact-input v4 swap; returns the amount out.
    function _swapIn(PoolKey memory key, bool zeroForOne, uint256 amountIn) private returns (uint256) {
        if (amountIn == 0 || amountIn > uint256(uint128(type(int128).max))) revert ZeroAmount();
        BalanceDelta d = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int128 o = zeroForOne ? d.amount1() : d.amount0();
        if (o <= 0) revert NoOutput();
        return uint256(uint128(o));
    }

    function _payOwed(address token) private {
        int256 d = poolManager.currencyDelta(address(this), Currency.wrap(token));
        if (d < 0) {
            poolManager.sync(Currency.wrap(token));
            IERC20(token).safeTransfer(address(poolManager), uint256(-d));
            poolManager.settle();
        }
    }

    function _takeAll(address token, address to) private returns (uint256 amount) {
        int256 d = poolManager.currencyDelta(address(this), Currency.wrap(token));
        if (d <= 0) revert NoOutput();
        amount = uint256(d);
        poolManager.take(Currency.wrap(token), to, amount);
    }

    // ------------------------------------------------------------------ the v3 dollar pool

    /// @dev Exact-input swap in the v3 dollar pool: USDC -> WETH (usdcIn) or WETH -> USDC.
    function _v3Swap(bool usdcIn, uint256 amountIn, address recipient) private returns (uint256 out) {
        if (amountIn == 0 || amountIn > uint256(type(int256).max)) revert ZeroAmount();
        bool zeroForOne = usdcIn == v3UsdcIs0;
        _tstore(V3_ACTIVE, 1);
        (int256 a0, int256 a1) = IV3PoolLike(dollarV3).swap(
            recipient, zeroForOne, int256(amountIn), zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1, ""
        );
        _tstore(V3_ACTIVE, 0);
        int256 o = zeroForOne ? a1 : a0;
        if (o >= 0) revert NoOutput();
        out = uint256(-o);
    }

    function uniswapV3SwapCallback(int256 a0, int256 a1, bytes calldata) external { _v3Pay(a0, a1); }

    function pancakeV3SwapCallback(int256 a0, int256 a1, bytes calldata) external { _v3Pay(a0, a1); }

    function _v3Pay(int256 a0, int256 a1) private {
        if (dollarV3 == address(0) || msg.sender != dollarV3 || _tload(V3_ACTIVE) != 1) revert NotDollarPool();
        // quote(): report what the pool would pay out, then undo everything
        if (_tload(V3_QUOTE) == 1) revert QuoteResult(uint256(-(a0 > 0 ? a1 : a0)));
        // pay what the pool asks for, in the token it is owed
        if (a0 > 0) IERC20(v3UsdcIs0 ? usdc : weth).safeTransfer(msg.sender, uint256(a0));
        if (a1 > 0) IERC20(v3UsdcIs0 ? weth : usdc).safeTransfer(msg.sender, uint256(a1));
    }

    // ------------------------------------------------------------------ helpers

    function _refund(address token, address to) private {
        if (to == address(0) || to == address(this)) return;
        uint256 b = IERC20(token).balanceOf(address(this));
        if (b > 0) IERC20(token).safeTransfer(to, b);
    }

    function _dollarKey() private view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(dollarC0), Currency.wrap(dollarC1), dollarFee, dollarTickSpacing, IHooks(dollarHooks));
    }

    /// @dev The coin's pool must be exactly coin/WETH (any fee, spacing and hook, e.g. Clanker's).
    function _checkCoinKey(address coin, PoolKey calldata k) private view {
        address c0 = Currency.unwrap(k.currency0);
        address c1 = Currency.unwrap(k.currency1);
        if (coin == address(0) || coin == usdc || coin == weth) revert BadCoinPool();
        if (!((c0 == coin && c1 == weth) || (c0 == weth && c1 == coin))) revert BadCoinPool();
    }

    function _tstore(bytes32 slot, uint256 v) private { assembly { tstore(slot, v) } }

    function _tload(bytes32 slot) private view returns (uint256 v) { assembly { v := tload(slot) } }
}
