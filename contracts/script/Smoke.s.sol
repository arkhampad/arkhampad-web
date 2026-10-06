// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PadHub} from "../src/PadHub.sol";
import {PadPoolBuilder} from "../src/PadPoolBuilder.sol";
import {FeeMode} from "../src/PadTypes.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// @notice Real-network check on a testnet: creates a coin with a $5 launch
/// buy (the minimum), which opens its pool and buys in it. Reads addresses from
/// deployments/<chainId>.json. Needs ~5 USDC on the deployer (on Robinhood
/// testnet it mints TestUSDC itself).
contract Smoke is Script {
    function _key() internal view returns (uint256) {
        string memory raw = vm.envString("PRIVATE_KEY");
        bytes memory b = bytes(raw);
        if (b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X")) return vm.parseUint(raw);
        return vm.parseUint(string.concat("0x", raw));
    }

    function run() external {
        uint256 key = _key();
        address me = vm.addr(key);
        string memory json = vm.readFile(string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        PadHub hub = PadHub(vm.parseJsonAddress(json, ".hub"));
        IERC20 usdc = IERC20(vm.parseJsonAddress(json, ".usdc"));

        vm.startBroadcast(key);
        uint256 buy = hub.minLaunchBuy();
        if (block.chainid == 46630 && usdc.balanceOf(me) < buy) TestUSDC(address(usdc)).mint(me, buy * 2);
        require(usdc.balanceOf(me) >= buy, "deployer needs the minimum launch buy in USDC");
        usdc.approve(address(hub), buy);
        address coin = hub.createCoin("Smoke Test", "SMOKE", "", 0, FeeMode.ToCreator, buy, 0);
        vm.stopBroadcast();

        (uint256 positionId,,) = PadPoolBuilder(address(hub.poolBuilder())).pools(coin);
        console2.log("coin     ", coin);
        console2.log("position ", positionId);
        console2.log("bought   ", IERC20(coin).balanceOf(me));
    }
}
