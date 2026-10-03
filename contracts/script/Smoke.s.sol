// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PadHub} from "../src/PadHub.sol";
import {PadCurve} from "../src/PadCurve.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// @notice Real-network check on a testnet: creates a coin with a $1 launch
/// buy, buys $1 more, sells half of it back. Reads addresses from
/// deployments/<chainId>.json. Needs ~2.1 USDC on the deployer (on Robinhood
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
        if (block.chainid == 46630 && usdc.balanceOf(me) < 3e6) TestUSDC(address(usdc)).mint(me, 10e6);
        require(usdc.balanceOf(me) >= 21e5, "deployer needs at least 2.1 USDC");
        usdc.approve(address(hub), 1e6);
        (address coin, address curveAddr) =
            hub.createCoin("Smoke Test", "SMOKE", "", 0, PadCurve.FeeMode.ToCreator, 1e6, 0);
        PadCurve curve = PadCurve(curveAddr);
        usdc.approve(curveAddr, 1e6);
        uint256 got = curve.buy(1e6, 0, me);
        IERC20(coin).approve(curveAddr, got / 2);
        uint256 back = curve.sell(got / 2, 0, me);
        vm.stopBroadcast();

        console2.log("coin    ", coin);
        console2.log("curve   ", curveAddr);
        console2.log("bought  ", got);
        console2.log("sold for", back);
        console2.log("mc (6d) ", curve.marketCap());
    }
}
