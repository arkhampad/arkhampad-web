// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PadExtSwap} from "../src/PadExtSwap.sol";

/// Deploys PadExtSwap on a mainnet where KyberSwap runs, allowlists the KyberSwap router and hands
/// admin to ADMIN. Env: PRIVATE_KEY, ADMIN. Fees go to the fee vault listed in deployments/<chainId>.json.
contract DeployExtSwap is Script {
    address constant KYBER_ROUTER = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5; // MetaAggregationRouterV2 (same on every chain)

    function run() external {
        // the key may be stored with or without the 0x prefix (same as Deploy.s.sol)
        string memory raw = vm.envString("PRIVATE_KEY");
        uint256 pk = vm.parseUint(bytes(raw).length == 64 ? string.concat("0x", raw) : raw);
        address admin = vm.envAddress("ADMIN");
        // Fees go to the chain's fee vault: read it from the main deploy so the two can't drift apart.
        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        address treasury = vm.parseJsonAddress(vm.readFile(path), ".vault");
        require(treasury != address(0), "deploy the main contracts (with the fee vault) first");
        // the chain's dollar token, from the same deploy file
        address usdc = vm.parseJsonAddress(vm.readFile(path), ".usdc");
        // other-DEX trading goes through KyberSwap: skip quietly where it isn't deployed
        if (KYBER_ROUTER.code.length == 0) {
            console2.log("KyberSwap router not on this chain: PadExtSwap skipped");
            return;
        }
        vm.startBroadcast(pk);
        PadExtSwap sw = new PadExtSwap(IERC20(usdc), vm.addr(pk), treasury);
        sw.setTarget(KYBER_ROUTER, true);
        if (admin != vm.addr(pk)) sw.setAdmin(admin);
        vm.stopBroadcast();
        console2.log("extSwap", address(sw));
    }
}
