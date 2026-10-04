// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {PadHub} from "../src/PadHub.sol";
import {PadPoolBuilder} from "../src/PadPoolBuilder.sol";
import {PadPromote} from "../src/PadPromote.sol";
import {PadInitGuard} from "../src/PadInitGuard.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {PadRouter} from "../src/PadRouter.sol";
import {IPadHub} from "../src/interfaces.sol";

/// @notice Deploys ArkhamPad on the current chain.
/// Env: PRIVATE_KEY (deployer), ADMIN, TREASURY, GUARDIAN (optional),
///      USDC (optional on testnets: a TestUSDC is deployed when empty),
///      CURVE (optional: "test" = $450 -> $750 graduation, default "main" = $4.5K -> $7.5K).
contract Deploy is Script {
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    struct V4 {
        address poolManager;
        address positionManager;
        address usdc;
    }

    function _chain() internal view returns (V4 memory v) {
        if (block.chainid == 46630 || block.chainid == 4663) {
            // Robinhood Chain testnet / mainnet (same Uniswap v4 addresses)
            v = V4(0x8366a39CC670B4001A1121B8F6A443A643e40951, 0x58daec3116aae6D93017bAAea7749052E8a04fA7, address(0));
        } else if (block.chainid == 84532) {
            v = V4(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408, 0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80, 0x036CbD53842c5426634e7929541eC2318f3dCF7e);
        } else if (block.chainid == 8453) {
            v = V4(0x498581fF718922c3f8e6A244956aF099B2652b2b, 0x7C5f5A4bBd8fD63184577525326123B519429bDc, 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
        } else {
            revert("unsupported chain");
        }
        v.usdc = vm.envOr("USDC", v.usdc);
    }

    function _mine(address deployer, address pm, address builder) internal pure returns (bytes32 salt) {
        bytes32 h = keccak256(abi.encodePacked(type(PadInitGuard).creationCode, abi.encode(pm, builder)));
        for (uint256 i; i < 2_000_000; ++i) {
            salt = bytes32(i);
            address a = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, h)))));
            if (uint160(a) & Hooks.ALL_HOOK_MASK == Hooks.BEFORE_INITIALIZE_FLAG) return salt;
        }
        revert("no salt");
    }

    /// @dev Accepts the private key with or without the 0x prefix (MetaMask exports it without).
    function _key() internal view returns (uint256) {
        string memory raw = vm.envString("PRIVATE_KEY");
        bytes memory b = bytes(raw);
        if (b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X")) return vm.parseUint(raw);
        return vm.parseUint(string.concat("0x", raw));
    }

    function run() external {
        uint256 key = _key();
        address deployer = vm.addr(key);
        address admin = vm.envOr("ADMIN", deployer);
        address treasury = vm.envOr("TREASURY", deployer);
        address guardian = vm.envOr("GUARDIAN", address(0));
        bool testCurve = keccak256(bytes(vm.envOr("CURVE", string("main")))) == keccak256("test");
        V4 memory v = _chain();

        PadHub.CurveParams memory cp = testCurve
            ? PadHub.CurveParams({vUsdc: 450e6, vCoin: 1e27, coinsForSale: 225403330717033245926072205, coinsReserved: 774596669282966754073927795})
            : PadHub.CurveParams({vUsdc: 4500e6, vCoin: 1e27, coinsForSale: 225403330717033245926072205, coinsReserved: 774596669282966754073927795});

        vm.startBroadcast(key);
        if (v.usdc == address(0)) {
            require(block.chainid != 4663 && block.chainid != 8453, "set USDC on mainnet");
            v.usdc = address(new TestUSDC());
        }
        uint64 nonce = vm.getNonce(deployer);
        address builderAddr = vm.computeCreateAddress(deployer, nonce);
        bytes32 salt = _mine(builderAddr, v.poolManager, builderAddr);
        PadPoolBuilder builder = new PadPoolBuilder(
            IPoolManager(v.poolManager), IPositionManager(v.positionManager), IAllowanceTransfer(PERMIT2), IERC20(v.usdc), salt
        );
        require(address(builder) == builderAddr, "builder address");
        // The hub starts with the deployer as admin so it can wire things; admin moves below.
        PadHub hub = new PadHub(IERC20(v.usdc), builder, cp, deployer, treasury);
        builder.bindHub(IPadHub(address(hub)));
        PadPromote promote = new PadPromote(IERC20(v.usdc), admin, treasury);
        PadRouter router = new PadRouter(hub, promote, builder);
        hub.setRouter(address(router));
        if (guardian != address(0)) hub.setGuardian(guardian);
        if (admin != deployer) hub.proposeAdmin(admin);
        // The chain's own block number from the RPC: on Arbitrum-based chains (Robinhood)
        // block.number inside the EVM is Ethereum's block number, not the chain's.
        uint256 startBlock = block.number;
        try vm.rpc("eth_blockNumber", "[]") returns (bytes memory raw) {
            if (raw.length > 0 && raw.length <= 32) {
                uint256 n;
                for (uint256 i; i < raw.length; ++i) n = (n << 8) | uint8(raw[i]);
                if (n > 0) startBlock = n > 50 ? n - 50 : n; // a little margin before our first transaction
            }
        } catch {}
        vm.stopBroadcast();

        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "startBlock", startBlock);
        vm.serializeAddress(o, "usdc", v.usdc);
        vm.serializeAddress(o, "hub", address(hub));
        vm.serializeAddress(o, "poolBuilder", address(builder));
        vm.serializeAddress(o, "guard", address(builder.guard()));
        vm.serializeAddress(o, "promote", address(promote));
        vm.serializeAddress(o, "router", address(router));
        vm.serializeAddress(o, "poolManager", v.poolManager);
        vm.serializeAddress(o, "positionManager", v.positionManager);
        vm.serializeAddress(o, "treasury", treasury);
        string memory json = vm.serializeAddress(o, "admin", admin);
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));

        console2.log("hub        ", address(hub));
        console2.log("poolBuilder", address(builder));
        console2.log("promote    ", address(promote));
        console2.log("router     ", address(router));
        console2.log("usdc       ", v.usdc);
        if (admin != deployer) console2.log("ADMIN must call hub.acceptAdmin():", admin);
    }
}
