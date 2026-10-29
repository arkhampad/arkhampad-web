// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArkhamV3Launcher, IV3PositionManager, IWrappedNative} from "../src/ArkhamV3Launcher.sol";
import {WHYPE} from "../src/WHYPE.sol";

/**
 * ArkhamPad on Elysium, in one run: WHYPE, Uniswap v3 (the official npm artifacts in v3/: factory,
 * position manager, swap router, quoter), then the launcher, then one smoke-test coin with a tiny first
 * buy, checked end to end. Pass WHYPE / FACTORY / NPM / ROUTER / QUOTER to reuse existing ones.
 *
 * env: PRIVATE_KEY, OWNER, TREASURY, START_MC (wei of HYPE for the whole supply), CREATOR_BPS,
 *      FEE (default 10000 = 1%), SPACING (default 200), SMOKE_BUY (wei, 0 = skip)
 */
contract DeployAll is Script {
    address whype;
    address factory;
    address npm;
    address router;
    address quoter;

    function _create(bytes memory code) internal returns (address a) {
        assembly ("memory-safe") {
            a := create(0, add(code, 0x20), mload(code))
        }
        require(a != address(0) && a.code.length > 0, "create failed");
    }

    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address owner = vm.envAddress("OWNER");
        address treasury = vm.envAddress("TREASURY");
        uint256 startMc = vm.envUint("START_MC");
        uint16 creatorBps = uint16(vm.envUint("CREATOR_BPS"));
        uint24 fee = uint24(vm.envOr("FEE", uint256(10_000)));
        int24 spacing = int24(int256(vm.envOr("SPACING", uint256(200))));
        uint256 smokeBuy = vm.envOr("SMOKE_BUY", uint256(0));
        whype = vm.envOr("WHYPE", address(0));
        factory = vm.envOr("FACTORY", address(0));
        npm = vm.envOr("NPM", address(0));
        router = vm.envOr("ROUTER", address(0));
        quoter = vm.envOr("QUOTER", address(0));
        address me = vm.addr(key);
        console2.log("deployer", me, "balance", me.balance);

        vm.startBroadcast(key);
        if (whype == address(0)) whype = address(new WHYPE());
        if (factory == address(0)) factory = _create(vm.getCode("v3/UniswapV3Factory.json"));
        if (npm == address(0)) {
            npm = _create(abi.encodePacked(vm.getCode("v3/NonfungiblePositionManager.json"), abi.encode(factory, whype, address(0))));
        }
        if (router == address(0)) router = _create(abi.encodePacked(vm.getCode("v3/SwapRouter.json"), abi.encode(factory, whype)));
        if (quoter == address(0)) quoter = _create(abi.encodePacked(vm.getCode("v3/QuoterV2.json"), abi.encode(factory, whype)));

        ArkhamV3Launcher l = new ArkhamV3Launcher(
            owner, IV3PositionManager(npm), IWrappedNative(whype), fee, spacing, treasury, startMc, creatorBps
        );
        address coin;
        uint256 bought;
        if (smokeBuy > 0) {
            (coin, bought) = l.launch{value: smokeBuy}("ArkhamPad Check", "CHECK", "https://arkhampad.com", me, 0);
        }
        vm.stopBroadcast();

        console2.log("whype", whype);
        console2.log("factory", factory);
        console2.log("positionManager", npm);
        console2.log("router", router);
        console2.log("quoter", quoter);
        console2.log("launcher", address(l));
        if (coin != address(0)) {
            (uint256 tokenId, address pool,,,) = l.coins(coin);
            console2.log("smoke coin", coin, "pool", pool);
            console2.log("tokenId", tokenId, "bought", bought);
            require(bought > 0 && IERC20(coin).balanceOf(me) == bought, "smoke buy failed");
            require(IERC20(coin).balanceOf(address(l)) == 0, "coins left in launcher");
        }

        _save(address(l), owner, treasury, fee, startMc, creatorBps, coin);
    }

    function _save(address l, address owner, address treasury, uint24 fee, uint256 startMc, uint16 creatorBps, address coin) internal {
        string memory o = "d";
        vm.serializeAddress(o, "whype", whype);
        vm.serializeAddress(o, "factory", factory);
        vm.serializeAddress(o, "positionManager", npm);
        vm.serializeAddress(o, "router", router);
        vm.serializeAddress(o, "quoter", quoter);
        vm.serializeAddress(o, "launcher", l);
        vm.serializeAddress(o, "owner", owner);
        vm.serializeAddress(o, "treasury", treasury);
        vm.serializeUint(o, "fee", fee);
        vm.serializeUint(o, "startMc", startMc);
        vm.serializeUint(o, "creatorBps", creatorBps);
        vm.serializeUint(o, "block", block.number);
        string memory json = vm.serializeAddress(o, "smokeCoin", coin);
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }
}
