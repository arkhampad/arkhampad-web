// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ArkhamRouter
/// @notice Buy and sell any HYPE-paired token on Elysium, whichever launchpad made it, paying and
/// receiving native HYPE. Works with Uniswap v3 style pools (called directly) and Uniswap v4 style
/// pool managers. Holds no funds between transactions. A small router fee (`feeBps`) goes to the
/// treasury; trades in ArkhamPad's own pools (`ownFactory`) pay no router fee (they already pay the
/// pool fee). `quote` answers what a trade would return right now (call it with eth_call).
interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IWrapped {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface IV3Pool {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
    function factory() external view returns (address);
}

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

contract ArkhamRouter {
    /// venue 3: `target` is a v3 pool. venue 4: `target` is a v4 pool manager.
    /// `hype` is the HYPE side of the pool: a wrapped HYPE token, or address(0) for native HYPE (v4).
    struct Pool {
        uint8 venue;
        address target;
        address token;
        address hype;
        bool tokenIs0;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    error Quote(uint256 amountOut);
    error Expired();
    error TooLittle(uint256 got, uint256 min);
    error BadVenue();
    error BadCaller();
    error BadAmount();
    error SendFailed();
    error Locked();
    error NotOwner();

    event Trade(address indexed user, address indexed token, bool isBuy, uint256 hypeAmount, uint256 tokenAmount, uint256 fee);
    event Settings(address treasury, uint16 feeBps, address ownFactory);
    event OwnerChanged(address owner);

    uint160 private constant MIN_SQRT = 4295128739 + 1;
    uint160 private constant MAX_SQRT = 1461446703485210103287273052203988822378723970342 - 1;
    uint16 public constant MAX_FEE_BPS = 100; // never more than 1%

    address public owner;
    address public treasury;
    uint16 public feeBps;
    address public ownFactory;

    // the pool or pool manager allowed to call back during the current trade (0 when idle)
    address private _active;
    // whose tokens a sell may pull (always the caller of the current trade; never taken from callback data)
    address private _payer;
    uint256 private _lock = 1;

    // what the current callback must do
    uint8 private constant M_BUY = 1;
    uint8 private constant M_SELL = 2;
    uint8 private constant M_QUOTE = 3;

    modifier guard() {
        if (_lock != 1) revert Locked();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address owner_, address treasury_, uint16 feeBps_, address ownFactory_) {
        owner = owner_;
        _setSettings(treasury_, feeBps_, ownFactory_);
    }

    receive() external payable {}

    // ------------------------------------------------------------------ admin
    function setSettings(address treasury_, uint16 feeBps_, address ownFactory_) external {
        if (msg.sender != owner) revert NotOwner();
        _setSettings(treasury_, feeBps_, ownFactory_);
    }

    function setOwner(address owner_) external {
        if (msg.sender != owner) revert NotOwner();
        owner = owner_;
        emit OwnerChanged(owner_);
    }

    function _setSettings(address treasury_, uint16 feeBps_, address ownFactory_) private {
        require(treasury_ != address(0) && feeBps_ <= MAX_FEE_BPS, "settings");
        treasury = treasury_;
        feeBps = feeBps_;
        ownFactory = ownFactory_;
        emit Settings(treasury_, feeBps_, ownFactory_);
    }

    /// Router fee for this pool in basis points (0 for ArkhamPad's own pools).
    function feeFor(Pool calldata p) public view returns (uint16) {
        if (p.venue == 3 && ownFactory != address(0)) {
            try IV3Pool(p.target).factory() returns (address f) {
                if (f == ownFactory) return 0;
            } catch {}
        }
        return feeBps;
    }

    // ------------------------------------------------------------------ trading
    /// Pay `msg.value` HYPE, receive at least `minOut` tokens.
    function buy(Pool calldata p, uint256 minOut, uint256 deadline) external payable guard returns (uint256 got) {
        if (block.timestamp > deadline) revert Expired();
        if (msg.value == 0) revert BadAmount();
        uint256 fee = (msg.value * feeFor(p)) / 10_000;
        uint256 amountIn = msg.value - fee;
        uint256 before = IERC20Min(p.token).balanceOf(msg.sender);
        uint256 spent = _swap(p, true, amountIn, msg.sender, msg.sender);
        got = IERC20Min(p.token).balanceOf(msg.sender) - before;
        if (got < minOut) revert TooLittle(got, minOut);
        // a pool that ran out of room takes less than offered: give the rest back (fee only on what was used)
        if (spent < amountIn) {
            uint256 unused = amountIn - spent;
            uint256 feeBack = fee == 0 ? 0 : (fee * unused) / amountIn;
            fee -= feeBack;
            _send(msg.sender, unused + feeBack);
        }
        if (fee > 0) _send(treasury, fee);
        emit Trade(msg.sender, p.token, true, msg.value, got, fee);
    }

    /// Sell `amountIn` tokens (approve this router first), receive at least `minOut` HYPE.
    function sell(Pool calldata p, uint256 amountIn, uint256 minOut, uint256 deadline) external guard returns (uint256 got) {
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0) revert BadAmount();
        uint256 bal = address(this).balance;
        _swap(p, false, amountIn, msg.sender, address(this));
        uint256 gross = address(this).balance - bal;
        uint256 fee = (gross * feeFor(p)) / 10_000;
        got = gross - fee;
        if (got < minOut) revert TooLittle(got, minOut);
        if (fee > 0) _send(treasury, fee);
        _send(msg.sender, got);
        emit Trade(msg.sender, p.token, false, got, amountIn, fee);
    }

    /// What `amountIn` (HYPE for a buy, tokens for a sell) would return right now, after the router
    /// fee. Changes nothing (the swap inside is undone); call it with eth_call.
    function quote(Pool calldata p, bool isBuy, uint256 amountIn) external guard returns (uint256 out) {
        if (amountIn == 0) return 0;
        uint16 f = feeFor(p);
        uint256 net = isBuy ? amountIn - (amountIn * f) / 10_000 : amountIn;
        _active = p.target;
        bytes memory reason;
        if (p.venue == 3) {
            bool zeroForOne = isBuy ? !p.tokenIs0 : p.tokenIs0;
            try IV3Pool(p.target).swap(address(this), zeroForOne, int256(net), zeroForOne ? MIN_SQRT : MAX_SQRT, abi.encode(M_QUOTE, p.tokenIs0, isBuy, address(0), address(0), 0)) {} catch (bytes memory r) { reason = r; }
        } else if (p.venue == 4) {
            try IPoolManager(p.target).unlock(abi.encode(M_QUOTE, p, isBuy, net, address(0), address(0))) {} catch (bytes memory r) { reason = r; }
        } else {
            revert BadVenue();
        }
        _active = address(0);
        out = _readQuote(reason);
        if (!isBuy) out -= (out * f) / 10_000;
    }

    function _readQuote(bytes memory reason) private pure returns (uint256 v) {
        // Quote(uint256) at the top level, or wrapped once by a pool manager (WrappedError etc.): find it
        bytes4 sel = Quote.selector;
        for (uint256 i = 0; i + 36 <= reason.length; i++) {
            bytes4 s;
            assembly ("memory-safe") { s := mload(add(add(reason, 32), i)) }
            if (s == sel) {
                assembly ("memory-safe") { v := mload(add(add(reason, 36), i)) }
                return v;
            }
        }
        // anything else: pass the pool's own error up
        assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
    }

    /// Runs one exact-input swap; returns how much of the input was actually used.
    function _swap(Pool calldata p, bool isBuy, uint256 amountIn, address payer, address recipient) private returns (uint256 spent) {
        _active = p.target;
        _payer = payer;
        if (p.venue == 3) {
            if (isBuy) IWrapped(p.hype).deposit{value: amountIn}();
            bool zeroForOne = isBuy ? !p.tokenIs0 : p.tokenIs0;
            (int256 a0, int256 a1) = IV3Pool(p.target).swap(
                isBuy ? recipient : address(this),
                zeroForOne,
                int256(amountIn),
                zeroForOne ? MIN_SQRT : MAX_SQRT,
                abi.encode(isBuy ? M_BUY : M_SELL, p.tokenIs0, isBuy, payer, isBuy ? p.hype : p.token, amountIn)
            );
            int256 paid = zeroForOne ? a0 : a1;
            spent = paid > 0 ? uint256(paid) : 0;
            if (isBuy && spent < amountIn) IWrapped(p.hype).withdraw(amountIn - spent);
            if (!isBuy) {
                int256 recv = zeroForOne ? a1 : a0;
                if (recv < 0) IWrapped(p.hype).withdraw(uint256(-recv));
            }
        } else if (p.venue == 4) {
            bytes memory r = IPoolManager(p.target).unlock(abi.encode(isBuy ? M_BUY : M_SELL, p, isBuy, amountIn, payer, recipient));
            spent = abi.decode(r, (uint256));
        } else {
            revert BadVenue();
        }
        _active = address(0);
        _payer = address(0);
    }

    // ------------------------------------------------------------------ v3 callback
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (msg.sender != _active || msg.sender == address(0)) revert BadCaller();
        (uint8 mode, bool tokenIs0, bool isBuy,, address payToken, uint256 cap) =
            abi.decode(data, (uint8, bool, bool, address, address, uint256));
        address payer = _payer;
        int256 tokenDelta = tokenIs0 ? amount0Delta : amount1Delta;
        int256 hypeDelta = tokenIs0 ? amount1Delta : amount0Delta;
        if (mode == M_QUOTE) {
            int256 outDelta = isBuy ? tokenDelta : hypeDelta;
            revert Quote(outDelta < 0 ? uint256(-outDelta) : 0);
        }
        int256 owe = isBuy ? hypeDelta : tokenDelta;
        if (owe <= 0) return;
        if (uint256(owe) > cap) revert BadAmount();
        if (mode == M_BUY) {
            _pay(payToken, msg.sender, uint256(owe));
        } else {
            _pull(payToken, payer, msg.sender, uint256(owe));
        }
    }

    // ------------------------------------------------------------------ v4 callback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != _active || msg.sender == address(0)) revert BadCaller();
        (uint8 mode, Pool memory p, bool isBuy, uint256 amountIn,, address recipient) =
            abi.decode(data, (uint8, Pool, bool, uint256, address, address));
        address payer = _payer;
        IPoolManager pm = IPoolManager(msg.sender);
        PoolKey memory key = p.tokenIs0
            ? PoolKey(p.token, p.hype, p.fee, p.tickSpacing, p.hooks)
            : PoolKey(p.hype, p.token, p.fee, p.tickSpacing, p.hooks);
        bool zeroForOne = isBuy ? !p.tokenIs0 : p.tokenIs0;
        int256 delta = pm.swap(key, SwapParams(zeroForOne, -int256(amountIn), zeroForOne ? MIN_SQRT : MAX_SQRT), "");
        int128 d0 = int128(delta >> 128);
        int128 d1 = int128(delta);
        int128 inD = zeroForOne ? d0 : d1; // negative: we owe
        int128 outD = zeroForOne ? d1 : d0; // positive: we receive
        uint256 owe = inD < 0 ? uint256(uint128(-inD)) : 0;
        uint256 got = outD > 0 ? uint256(uint128(outD)) : 0;
        if (mode == M_QUOTE) revert Quote(got);
        if (owe > amountIn) revert BadAmount();

        address inCur = isBuy ? p.hype : p.token;
        address outCur = isBuy ? p.token : p.hype;
        if (owe > 0) {
            if (inCur == address(0)) {
                pm.settle{value: owe}();
            } else {
                pm.sync(inCur);
                if (isBuy) {
                    IWrapped(inCur).deposit{value: owe}();
                    _pay(inCur, address(pm), owe);
                } else {
                    _pull(inCur, payer, address(pm), owe);
                }
                pm.settle();
            }
        }
        if (got > 0) {
            if (isBuy) {
                pm.take(outCur, recipient, got);
            } else {
                pm.take(outCur, address(this), got);
                if (outCur != address(0)) IWrapped(outCur).withdraw(got);
            }
        }
        return abi.encode(owe);
    }

    // ------------------------------------------------------------------ helpers
    function _pay(address token, address to, uint256 amount) private {
        (bool ok, bytes memory r) = token.call(abi.encodeCall(IERC20Min.transfer, (to, amount)));
        if (!ok || (r.length > 0 && !abi.decode(r, (bool)))) revert SendFailed();
    }

    function _pull(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory r) = token.call(abi.encodeCall(IERC20Min.transferFrom, (from, to, amount)));
        if (!ok || (r.length > 0 && !abi.decode(r, (bool)))) revert SendFailed();
    }

    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert SendFailed();
    }
}
