// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArkhamV3LauncherV2} from "../src/ArkhamV3LauncherV2.sol";
import {ArkhamRouter} from "../src/ArkhamRouter.sol";

/**
 * Second run after DeployLauncherV2.s.sol: checks the smoke coin it launched (the launcher's newest coin,
 * read from the chain), end to end: it belongs to the deployer, a buy and a sell through ArkhamPad's router
 * work, fees collect at the starting split (20% creator, 15% held, the rest to ArkhamPad) and the launcher
 * holds exactly the held part. Adds smokeCoinV2 to deployments/<chain id>-v2.json.
 *
 * env: PRIVATE_KEY, SMOKE_BUY (wei; the router buy is a quarter of it)
 */
contract SmokeLauncherV2 is Script {
    function run() external {
        string memory raw = vm.envString("PRIVATE_KEY");
        bytes memory rb = bytes(raw);
        bool hasPrefix = rb.length > 1 && rb[0] == "0" && (rb[1] == "x" || rb[1] == "X");
        uint256 key = vm.parseUint(hasPrefix ? raw : string.concat("0x", raw));
        address me = vm.addr(key);
        uint256 smokeBuy = vm.envUint("SMOKE_BUY");

        string memory v2path = string.concat("deployments/", vm.toString(block.chainid), "-v2.json");
        string memory v2rec = vm.readFile(v2path);
        ArkhamV3LauncherV2 l = ArkhamV3LauncherV2(payable(vm.parseJsonAddress(v2rec, ".launcherV2")));
        string memory rec = vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
        address whype = vm.parseJsonAddress(rec, ".whype");
        address ark = vm.parseJsonAddress(rec, ".arkhamRouter");

        uint256 n = l.coinCount();
        require(n > 0, "no smoke coin");
        address coin = l.allCoins(n - 1);
        (, address pool, address cr, uint16 bps, bool is0) = l.coins(coin);
        require(cr == me && bps == 2_000, "smoke coin");
        uint256 first = IERC20(coin).balanceOf(me);
        require(first > 0, "first buy");
        require(l.marketCap(coin) > 0, "market cap");

        vm.startBroadcast(key);
        ArkhamRouter.Pool memory p = ArkhamRouter.Pool(3, pool, coin, whype, is0, l.fee(), l.tickSpacing(), address(0));
        uint256 viaRouter = ArkhamRouter(payable(ark)).buy{value: smokeBuy / 4}(p, 1, block.timestamp + 600);
        IERC20(coin).approve(ark, viaRouter);
        uint256 back = ArkhamRouter(payable(ark)).sell(p, viaRouter, 1, block.timestamp + 600);
        l.collect(coin);
        vm.stopBroadcast();

        require(viaRouter > 0 && back > 0, "router round trip failed");
        require(IERC20(coin).balanceOf(me) >= first, "coins");
        (uint16 cb, uint16 hb) = l.sharesNow(coin);
        require(cb == 2_000 && hb == 1_500, "starting share");
        // the held 15% of the smoke trades' fees sits in the launcher, and nothing else
        require(address(l).balance == l.heldNativeTotal() && l.heldNativeTotal() > 0, "books");
        console2.log("smoke coin", coin);
        console2.log("router round trip: coins", viaRouter, "HYPE back", back);
        console2.log("held for the creator (wei)", l.heldNativeTotal());

        vm.writeJson(string.concat('"', vm.toString(coin), '"'), v2path, ".smokeCoinV2");
    }
}
