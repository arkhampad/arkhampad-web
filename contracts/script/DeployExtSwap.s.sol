// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PadExtSwap} from "../src/PadExtSwap.sol";

/// Deploys PadExtSwap on a mainnet (Base for now), allowlists the KyberSwap router and hands
/// admin to ADMIN. Env: PRIVATE_KEY, ADMIN. Fees go to the fee vault listed in deployments/<chainId>.json.
contract DeployExtSwap is Script {
    address constant KYBER_ROUTER = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5; // MetaAggregationRouterV2 (same on every chain)

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address admin = vm.envAddress("ADMIN");
        // Fees go to the chain's fee vault: read it from the main deploy so the two can't drift apart.
        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        address treasury = vm.parseJsonAddress(vm.readFile(path), ".vault");
        require(treasury != address(0), "deploy the main contracts (with the fee vault) first");
        address usdc;
        if (block.chainid == 8453) usdc = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        else revert("PadExtSwap: network not supported yet");
        vm.startBroadcast(pk);
        PadExtSwap sw = new PadExtSwap(IERC20(usdc), vm.addr(pk), treasury);
        sw.setTarget(KYBER_ROUTER, true);
        if (admin != vm.addr(pk)) sw.setAdmin(admin);
        vm.stopBroadcast();
        console2.log("extSwap", address(sw));
    }
}
