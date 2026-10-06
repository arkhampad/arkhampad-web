// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PadFeeVault} from "../src/PadFeeVault.sol";

interface IHubView { function treasury() external view returns (address); function admin() external view returns (address); function pendingAdmin() external view returns (address); function router() external view returns (address); function guardian() external view returns (address); }
interface ITreasuryView { function treasury() external view returns (address); function admin() external view returns (address); }

/// Read-only check after a deploy (run it with --rpc-url, no key needed): every fee goes to the
/// fee vault, the vault belongs to the treasury wallet, the relayer is the only payer, and admin
/// rights sit where they should. Fails loudly on any mismatch.
/// Env: TREASURY, RELAYER, ADMIN (expected values). Optional: EXT_SWAP (PadExtSwap address).
contract Verify is Script {
    function run() external view {
        string memory json = vm.readFile(string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        address vault = vm.parseJsonAddress(json, ".vault");
        address hub = vm.parseJsonAddress(json, ".hub");
        address promote = vm.parseJsonAddress(json, ".promote");
        address router = vm.parseJsonAddress(json, ".router");
        address treasury = vm.envAddress("TREASURY");
        address relayer = vm.envAddress("RELAYER");
        address admin = vm.envAddress("ADMIN");

        require(IHubView(hub).treasury() == vault, "hub treasury is not the fee vault");
        require(ITreasuryView(promote).treasury() == vault, "promote treasury is not the fee vault");
        require(PadFeeVault(vault).owner() == treasury, "vault owner is not the treasury wallet");
        require(PadFeeVault(vault).payer() == relayer, "vault payer is not the relayer");
        require(PadFeeVault(vault).dailyCap() > 0, "vault daily cap is zero");
        require(IHubView(hub).router() == router, "hub router mismatch");
        // admin handover is two-step: after the deploy the admin wallet still has to accept
        require(IHubView(hub).admin() == admin || IHubView(hub).pendingAdmin() == admin, "hub admin is not (or not proposed as) ADMIN");
        require(ITreasuryView(promote).admin() == admin, "promote admin is not ADMIN");
        address ext = vm.envOr("EXT_SWAP", address(0));
        if (ext != address(0)) {
            require(ITreasuryView(ext).treasury() == vault, "ext swap treasury is not the fee vault");
        }
        console2.log("OK: all fees go to the vault", vault);
        console2.log("    vault owner", treasury, "payer", relayer);
        if (IHubView(hub).admin() != admin) console2.log("    NOTE: ADMIN must still call acceptAdmin() on the hub");
    }
}
