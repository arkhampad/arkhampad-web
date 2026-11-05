// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ArkhamV3Launcher, IV3PositionManager, IWrappedNative} from "../src/ArkhamV3Launcher.sol";
import {ArkhamV3LauncherV2} from "../src/ArkhamV3LauncherV2.sol";

/**
 * Deploys ArkhamPad's launcher version 2 ("25K" fee rules) next to version 1, on the same WHYPE and Uniswap
 * v3 position manager, and launches a tiny smoke coin that SmokeLauncherV2.s.sol then checks end to end
 * (a buy and a sell through ArkhamPad's router, a fee collection). Nothing about version 1 changes. OWNER
 * owns it from the start.
 *
 * Read from the deploy record (deployments/<chain id>.json): whype, positionManager, launcher.
 * Read from version 1 on chain (so version 2 starts exactly like it): treasury, startMc, fee, tickSpacing.
 *
 * env: PRIVATE_KEY, OWNER, KEEPER, LEVEL1_MC and LEVEL2_MC (wei of HYPE for the whole supply: about $25K and
 *      $100K), SMOKE_BUY (wei, 0 = skip the smoke coin)
 * Writes deployments/<chain id>-v2.json (the workflow merges it into the deploy record after the smoke check).
 */
contract DeployLauncherV2 is Script {
    function run() external {
        string memory raw = vm.envString("PRIVATE_KEY");
        bytes memory rb = bytes(raw);
        bool hasPrefix = rb.length > 1 && rb[0] == "0" && (rb[1] == "x" || rb[1] == "X");
        uint256 key = vm.parseUint(hasPrefix ? raw : string.concat("0x", raw));
        address me = vm.addr(key);
        address owner = vm.envAddress("OWNER");
        address keeper = vm.envAddress("KEEPER");
        uint256 l1 = vm.envUint("LEVEL1_MC");
        uint256 l2 = vm.envUint("LEVEL2_MC");
        uint256 smokeBuy = vm.envOr("SMOKE_BUY", uint256(0));

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory rec = vm.readFile(path);
        address whype = vm.parseJsonAddress(rec, ".whype");
        address npm = vm.parseJsonAddress(rec, ".positionManager");
        ArkhamV3Launcher v1 = ArkhamV3Launcher(payable(vm.parseJsonAddress(rec, ".launcher")));

        address treasury = v1.treasury();
        uint256 startMc = v1.startMc();
        uint24 fee = v1.fee();
        int24 spacing = v1.tickSpacing();
        require(address(v1.positions()) == npm && address(v1.wrapped()) == whype, "record and version 1 disagree");
        require(l1 > startMc && l2 > l1, "levels must sit above the start market cap, level 2 above level 1");
        console2.log("deployer", me, "balance", me.balance);
        console2.log("version 1", address(v1));
        console2.log("treasury", treasury);
        console2.log("startMc", startMc);
        console2.log("level1Mc", l1);
        console2.log("level2Mc", l2);

        vm.startBroadcast(key);
        ArkhamV3LauncherV2 l = new ArkhamV3LauncherV2(owner, IV3PositionManager(npm), IWrappedNative(whype), fee, spacing, treasury, startMc, l1, l2, keeper);
        // the smoke coin: launched here, checked by SmokeLauncherV2.s.sol in a second run (a coin's address
        // depends on the block it lands in, so it can only be read back once this run is on chain)
        if (smokeBuy > 0) l.launch{value: smokeBuy}("ArkhamPad Check", "CHECK", "https://arkhampad.com", me, 0);
        vm.stopBroadcast();

        console2.log("launcherV2", address(l));
        require(l.owner() == owner && l.keeper() == keeper && l.level1Mc() == l1 && l.level2Mc() == l2 && l.treasury() == treasury, "settings");
        require(l.startMc() == startMc && l.fee() == fee && l.tickSpacing() == spacing, "same as version 1");

        string memory o = "v2";
        vm.serializeAddress(o, "launcherV2", address(l));
        vm.serializeUint(o, "launcherV2Block", block.number);
        vm.serializeUint(o, "level1Mc", l1);
        vm.serializeUint(o, "level2Mc", l2);
        vm.serializeAddress(o, "keeperV2", keeper);
        string memory json = vm.serializeAddress(o, "smokeCoinV2", address(0)); // filled in by SmokeLauncherV2
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-v2.json"));
    }
}
