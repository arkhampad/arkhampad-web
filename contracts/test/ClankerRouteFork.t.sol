// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PadClankerRoute} from "../src/PadClankerRoute.sol";
import {PadExtSwap} from "../src/PadExtSwap.sol";

interface IClankerLocker {
    struct TokenRewardInfo {
        address token;
        PoolKey poolKey;
        uint256 positionId;
        uint256 numPositions;
        uint16[] rewardBps;
        address[] rewardAdmins;
        address[] rewardRecipients;
    }
    function tokenRewards(address token) external view returns (TokenRewardInfo memory);
}

/// @notice Real networks: ArkhamPad's live Clanker coin bought and sold through the new route and the
/// real PadExtSwap flow (signature, 1% fee, network fee), on a local copy of the chain.
/// Contract names start with <Chain>MainnetForkTest so the CI fork step runs them.
abstract contract ClankerRouteForkBase is Test {
    bool on;
    PadClankerRoute route;
    PadExtSwap sw;
    PoolKey coinKey;
    uint256 pk;
    address user;
    address treasury = address(0x7EA5);
    address relayer = address(0x5E1A);

    function _rpcEnv() internal pure virtual returns (string memory);
    function _pm() internal pure virtual returns (address);
    function _usdc() internal pure virtual returns (address);
    function _weth() internal pure virtual returns (address);
    function _coin() internal pure virtual returns (address);
    function _lockers() internal pure virtual returns (address[] memory);
    function _dollarKey() internal pure virtual returns (PoolKey memory);
    function _dollarV3() internal pure virtual returns (address) { return address(0); }
    function _one() internal view returns (uint256) { return 10 ** _dec(); }
    function _dec() internal view returns (uint8) { return IERC20Meta(_usdc()).decimals(); }

    function setUp() public {
        string memory rpc = vm.envOr(_rpcEnv(), string(""));
        if (bytes(rpc).length == 0) { require(!vm.envOr("CI", false), "missing RPC secret"); return; }
        vm.createSelectFork(rpc);
        on = true;
        route = new PadClankerRoute(IPoolManager(_pm()), _usdc(), _weth(), _dollarKey(), _dollarV3());
        sw = new PadExtSwap(IERC20(_usdc()), address(this), treasury);
        sw.setTarget(address(route), true);
        // the live coin's pool, read from Clanker's locker
        address[] memory ls = _lockers();
        for (uint256 i; i < ls.length; i++) {
            try IClankerLocker(ls[i]).tokenRewards(_coin()) returns (IClankerLocker.TokenRewardInfo memory info) {
                if (info.token == _coin()) { coinKey = info.poolKey; break; }
            } catch {}
        }
        require(Currency.unwrap(coinKey.currency0) != address(0) || Currency.unwrap(coinKey.currency1) != address(0), "coin pool not found");
        pk = uint256(keccak256(abi.encode("arkhampad clanker route", block.chainid)));
        user = vm.addr(pk);
        deal(_usdc(), user, 100 * _one());
        vm.startPrank(user);
        IERC20(_usdc()).approve(address(sw), type(uint256).max);
        IERC20(_coin()).approve(address(sw), type(uint256).max);
        vm.stopPrank();
        console2.log("forked chain", block.chainid, "at block", block.number);
    }

    function _signed(PadExtSwap.Swap memory s) internal view returns (PadExtSwap.Swap memory) {
        bytes32 h = keccak256(abi.encode(sw.EXT_SWAP_TYPEHASH(), s.user, s.isBuy, s.coin, s.amountIn, s.minOut, s.target, keccak256(s.data), s.fee, s.nonce, s.deadline));
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", sw.domainSeparator(), h)));
        s.signature = abi.encodePacked(r, ss, v);
        return s;
    }

    function _nothingLeft() internal view {
        assertEq(IERC20(_usdc()).balanceOf(address(route)), 0, "route kept USDC");
        assertEq(IERC20(_weth()).balanceOf(address(route)), 0, "route kept WETH");
        assertEq(IERC20(_coin()).balanceOf(address(route)), 0, "route kept coins");
        assertEq(address(route).balance, 0, "route kept ETH");
        assertEq(IERC20(_usdc()).balanceOf(address(sw)), 0, "PadExtSwap kept USDC");
        assertEq(IERC20(_coin()).balanceOf(address(sw)), 0, "PadExtSwap kept coins");
    }

    /// $10 buy and the full sell-back of the live coin, exactly as the site will send them.
    function test_liveCoinBuyAndSell() public {
        if (!on) return;
        uint256 one = _one();
        uint256 amountIn = 10 * one;
        uint256 fee = one / 20; // $0.05 network fee
        uint256 spend = amountIn - (amountIn * 100) / 10_000;
        uint256 q = route.quote(true, _coin(), spend, coinKey);
        assertGt(q, 0, "no quote");
        // the check the relayer runs before every buy: buying and selling straight back
        (uint256 rc, uint256 rb) = route.quoteRoundTrip(_coin(), spend, coinKey);
        assertEq(rc, q, "round trip: coins");
        PadExtSwap.Swap memory s = _signed(PadExtSwap.Swap(user, true, _coin(), amountIn, (q * 98) / 100, address(route),
            abi.encodeCall(PadClankerRoute.buy, (_coin(), spend, coinKey)), fee, 1, block.timestamp + 120, ""));
        uint256 u0 = IERC20(_usdc()).balanceOf(user);
        vm.prank(relayer);
        uint256 got = sw.swap(s);
        assertEq(got, q, "buy != quote");
        assertEq(IERC20(_coin()).balanceOf(user), got);
        assertEq(u0 - IERC20(_usdc()).balanceOf(user), amountIn + fee, "user paid amount + fee");
        assertEq(IERC20(_usdc()).balanceOf(treasury), amountIn / 100, "1% to treasury");
        _nothingLeft();
        console2.log("bought coins", got / 1e18);

        uint256 qs = route.quote(false, _coin(), got, coinKey);
        uint256 expect = qs - (qs * 100) / 10_000 - fee;
        PadExtSwap.Swap memory s2 = _signed(PadExtSwap.Swap(user, false, _coin(), got, (expect * 98) / 100, address(route),
            abi.encodeCall(PadClankerRoute.sell, (_coin(), got, coinKey)), fee, 2, block.timestamp + 120, ""));
        uint256 u1 = IERC20(_usdc()).balanceOf(user);
        vm.prank(relayer);
        uint256 back = sw.swap(s2);
        assertEq(back, expect, "sell != quote");
        // the round-trip quote (before the buy) said what the sale returns
        assertApproxEqRel(rb, qs, 0.001e18, "round trip: dollars back");
        assertEq(IERC20(_usdc()).balanceOf(user) - u1, back);
        assertEq(IERC20(_coin()).balanceOf(user), 0, "all coins sold");
        _nothingLeft();
        // the pools' own cut both ways (Clanker 1% + 1%, the dollar pool) and the price impact of
        // a $10 trade: the route itself must return at least 90% of what went in
        assertGt(qs, (spend * 90) / 100, "round trip lost too much");
        console2.log("spent (chain units)", spend);
        console2.log("sold back for", qs);
    }
}

interface IERC20Meta {
    function decimals() external view returns (uint8);
}

function _list(address a) pure returns (address[] memory l) { l = new address[](1); l[0] = a; }
function _noKey() pure returns (PoolKey memory) { return PoolKey(Currency.wrap(address(0)), Currency.wrap(address(0)), 0, 0, IHooks(address(0))); }

/// Base: dollar pool = Uniswap v4 native ETH/USDC 0.05% (the deep one); coin = FPENG
contract BaseMainnetForkTestClankerRoute is ClankerRouteForkBase {
    function _rpcEnv() internal pure override returns (string memory) { return "BASE_RPC"; }
    function _pm() internal pure override returns (address) { return 0x498581fF718922c3f8e6A244956aF099B2652b2b; }
    function _usdc() internal pure override returns (address) { return 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; }
    function _weth() internal pure override returns (address) { return 0x4200000000000000000000000000000000000006; }
    function _coin() internal pure override returns (address) { return 0xcFE1aeb9cC8b00795194E9878a4FaDE0cEBb60A1; }
    function _lockers() internal pure override returns (address[] memory) { return _list(0xffA37784D619F228D8B379d287a4D7282e500762); }
    function _dollarKey() internal pure override returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913), 500, 10, IHooks(address(0)));
    }
}

/// Robinhood Chain: dollar pool = Uniswap v4 native ETH/USDG 0.01%; coin = FLPPR
contract RobinhoodMainnetForkTestClankerRoute is ClankerRouteForkBase {
    function _rpcEnv() internal pure override returns (string memory) { return "ROBINHOOD_RPC"; }
    function _pm() internal pure override returns (address) { return 0x8366a39CC670B4001A1121B8F6A443A643e40951; }
    function _usdc() internal pure override returns (address) { return 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168; }
    function _weth() internal pure override returns (address) { return 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73; }
    function _coin() internal pure override returns (address) { return 0x1A087dC194727C474292a84cd68D93b7c11D94F2; }
    function _lockers() internal pure override returns (address[] memory) { return _list(0xE4910b09709423aFafD995dD76D8A81CF9134A09); }
    function _dollarKey() internal pure override returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168), 100, 1, IHooks(address(0)));
    }
}

/// BNB Chain: dollar pool = PancakeSwap v3 USDC/WBNB 0.01% (v4 is shallow there); coin = RRR
contract BnbMainnetForkTestClankerRoute is ClankerRouteForkBase {
    function _rpcEnv() internal pure override returns (string memory) { return "BNB_RPC"; }
    function _pm() internal pure override returns (address) { return 0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF; }
    function _usdc() internal pure override returns (address) { return 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d; }
    function _weth() internal pure override returns (address) { return 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c; }
    function _coin() internal pure override returns (address) { return 0x09456868A05eb1FE084603E41a241dc0Da626305; }
    function _lockers() internal pure override returns (address[] memory) { return _list(0x1166022e1becc70E7E9aB2250aF1aC7842B9B420); }
    function _dollarKey() internal pure override returns (PoolKey memory) { return _noKey(); }
    function _dollarV3() internal pure override returns (address) { return 0xf2688Fb5B81049DFB7703aDa5e770543770612C4; }
}
