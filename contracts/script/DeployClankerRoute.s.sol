// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PadClankerRoute} from "../src/PadClankerRoute.sol";

interface IClankerLockerView {
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

/// Deploys PadClankerRoute on Base, BNB Chain or Robinhood Chain with the dollar pool the
/// fork tests used, then quotes a $10 buy of ArkhamPad's live Clanker coin through it (a dry run
/// does all of this on the real chain state without sending anything).
/// The route has no owner and no settings. PadExtSwap's admin allowlists it afterwards.
/// Env: PRIVATE_KEY. Prints "clankerRoute <address>" for the workflow to save.
contract DeployClankerRoute is Script {
    struct Cfg {
        address pm;
        address usdc;
        address weth;
        PoolKey dollarKey;
        address dollarV3;
        address liveCoin;
        address locker;
        uint256 ten; // $10 in the chain's USDC units
    }

    function _cfg() internal view returns (Cfg memory c) {
        if (block.chainid == 8453) {
            c = Cfg(0x498581fF718922c3f8e6A244956aF099B2652b2b, 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, 0x4200000000000000000000000000000000000006,
                PoolKey(Currency.wrap(address(0)), Currency.wrap(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913), 500, 10, IHooks(address(0))), address(0),
                0xcFE1aeb9cC8b00795194E9878a4FaDE0cEBb60A1, 0xffA37784D619F228D8B379d287a4D7282e500762, 10e6);
        } else if (block.chainid == 4663) {
            c = Cfg(0x8366a39CC670B4001A1121B8F6A443A643e40951, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73,
                PoolKey(Currency.wrap(address(0)), Currency.wrap(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168), 100, 1, IHooks(address(0))), address(0),
                0x1A087dC194727C474292a84cd68D93b7c11D94F2, 0xE4910b09709423aFafD995dD76D8A81CF9134A09, 10e6);
        } else if (block.chainid == 56) {
            c = Cfg(0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF, 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d, 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c,
                PoolKey(Currency.wrap(address(0)), Currency.wrap(address(0)), 0, 0, IHooks(address(0))), 0xf2688Fb5B81049DFB7703aDa5e770543770612C4,
                0x09456868A05eb1FE084603E41a241dc0Da626305, 0x1166022e1becc70E7E9aB2250aF1aC7842B9B420, 10e18);
        } else {
            revert("PadClankerRoute: not set up for this network");
        }
    }

    function run() external {
        string memory raw = vm.envString("PRIVATE_KEY");
        uint256 pk = vm.parseUint(bytes(raw).length == 64 ? string.concat("0x", raw) : raw);
        Cfg memory c = _cfg();
        vm.startBroadcast(pk);
        PadClankerRoute route = new PadClankerRoute(IPoolManager(c.pm), c.usdc, c.weth, c.dollarKey, c.dollarV3);
        vm.stopBroadcast();
        console2.log("clankerRoute", address(route));
        // check it on the real pools: a $10 buy of the live coin, and selling those coins back
        PoolKey memory k = IClankerLockerView(c.locker).tokenRewards(c.liveCoin).poolKey;
        uint256 coins = route.quote(true, c.liveCoin, c.ten, k);
        uint256 back = route.quote(false, c.liveCoin, coins, k);
        console2.log("quote: $10 buys coins", coins / 1e18);
        console2.log("quote: selling them back gives (chain units)", back);
        require(coins > 0 && back > (c.ten * 90) / 100, "route quote check failed");
    }
}
