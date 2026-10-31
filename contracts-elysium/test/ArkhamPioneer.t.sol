// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {ArkhamPioneer} from "../src/ArkhamPioneer.sol";

contract ArkhamPioneerTest is Test {
    ArkhamPioneer p;
    function setUp() public { p = new ArkhamPioneer(); }

    function testMintOncePerWallet() public {
        vm.prank(address(1));
        assertEq(p.mint(), 1);
        vm.prank(address(1));
        vm.expectRevert(ArkhamPioneer.AlreadyMinted.selector);
        p.mint();
        vm.prank(address(2));
        assertEq(p.mint(), 2);
        assertEq(p.totalSupply(), 2);
        assertEq(p.ownerOf(2), address(2));
        p.tokenURI(1);
        vm.expectRevert(ArkhamPioneer.NotMinted.selector);
        p.tokenURI(3);
    }

    function testMintGas() public {
        vm.prank(address(7));
        uint256 g = gasleft();
        p.mint();
        emit log_named_uint("mint gas", g - gasleft());
    }

    function skip_testDumpArt() public {
        uint256[8] memory ids = [uint256(1), 42, 100, 101, 777, 1001, 4242, 9999];
        for (uint256 i; i < ids.length; i++) {
            vm.writeFile(string.concat("deployments/pioneer-", vm.toString(ids[i]), ".svg"), p.art(ids[i]));
        }
        vm.writeFile("deployments/pioneer-meta-42.txt", p.meta(42));
        // find a few Aurora ones
        uint256 found;
        for (uint256 id = 1001; id < 3000 && found < 2; id++) {
            if (keccak256(bytes(p.look(id).colorName)) == keccak256("Aurora")) {
                vm.writeFile(string.concat("deployments/pioneer-aurora-", vm.toString(id), ".svg"), p.art(id));
                found++;
            }
        }
    }
}
