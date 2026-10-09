// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PadFeeVault} from "../src/PadFeeVault.sol";
import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {PadHub} from "../src/PadHub.sol";
import {PadPoolBuilder} from "../src/PadPoolBuilder.sol";
import {PadPromote} from "../src/PadPromote.sol";
import {PadLaunchHook} from "../src/PadLaunchHook.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {PadRouter} from "../src/PadRouter.sol";
import {IPadHub} from "../src/interfaces.sol";

/// @notice Deploys ArkhamPad on the current chain.
/// Env: PRIVATE_KEY (deployer), ADMIN, TREASURY, GUARDIAN (optional),
///      USDC (optional on testnets: a TestUSDC is deployed when empty),
///      CURVE (optional: "test" = coins open at a $450 market cap, default "main" = START_MC).
///      START_MC (optional, whole dollars: the launch market cap on "main", default 2000).
contract Deploy is Script {
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    struct V4 {
        address poolManager;
        address positionManager;
        address usdc;
    }

    function _chain() internal view returns (V4 memory v) {
        if (block.chainid == 46630) {
            // Robinhood Chain testnet: our TestUSDC from the first deployment, kept so test balances
            // and the faucet survive redeploys (set USDC= to deploy a fresh one instead)
            v = V4(0x8366a39CC670B4001A1121B8F6A443A643e40951, 0x58daec3116aae6D93017bAAea7749052E8a04fA7, 0x47AfD49069EAbEcfb153926f1f652249fFb61b57);
        } else if (block.chainid == 4663) {
            // Robinhood Chain mainnet: same Uniswap v4 addresses; the dollar is USDG (Global Dollar, 6 decimals)
            v = V4(0x8366a39CC670B4001A1121B8F6A443A643e40951, 0x58daec3116aae6D93017bAAea7749052E8a04fA7, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
        } else if (block.chainid == 84532) {
            v = V4(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408, 0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80, 0x036CbD53842c5426634e7929541eC2318f3dCF7e);
        } else if (block.chainid == 56) {
            // BNB Chain mainnet: Binance-Peg USDC has 18 decimals and no permit
            v = V4(0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF, 0x7A4a5c919aE2541AeD11041A1AEeE68f1287f95b, 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d);
        } else if (block.chainid == 5042) {
            // Arc mainnet (Circle): USDC is the gas token; its ERC-20 interface has 6 decimals
            v = V4(0x8366a39CC670B4001A1121B8F6A443A643e40951, 0x6049c9a0e26405C0985f9E3685C87d0aE917f82B, 0x3600000000000000000000000000000000000000);
        } else if (block.chainid == 8453) {
            v = V4(0x498581fF718922c3f8e6A244956aF099B2652b2b, 0x7C5f5A4bBd8fD63184577525326123B519429bDc, 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
        } else {
            revert("unsupported chain");
        }
        v.usdc = vm.envOr("USDC", v.usdc);
    }

    function _mine(address deployer, address pm, address builder) internal pure returns (bytes32 salt) {
        bytes32 h = keccak256(abi.encodePacked(type(PadLaunchHook).creationCode, abi.encode(pm, builder)));
        for (uint256 i; i < 2_000_000; ++i) {
            salt = bytes32(i);
            address a = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, h)))));
            if (uint160(a) & Hooks.ALL_HOOK_MASK == (Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG)) return salt;
        }
        revert("no salt");
    }

    /// @dev Accepts the private key with or without the 0x prefix (MetaMask exports it without).
    function _mainnet() internal view returns (bool) {
        return block.chainid == 4663 || block.chainid == 8453 || block.chainid == 56 || block.chainid == 5042;
    }

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
        // Mainnet: admin and treasury must be set on purpose (a Safe), never the hot deployer key.
        if (_mainnet()) {
            require(admin != deployer, "mainnet: set ADMIN to the Safe (not the deployer)");
            require(treasury != deployer, "mainnet: set TREASURY to the Safe or a separate wallet (not the deployer)");
        }
        address guardian = vm.envOr("GUARDIAN", address(0));
        bool testCurve = keccak256(bytes(vm.envOr("CURVE", string("main")))) == keccak256("test");
        V4 memory v = _chain();
        // the PositionManager must belong to this PoolManager (guards against a wrong address)
        require(address(IPositionManager(v.positionManager).poolManager()) == v.poolManager, "positionManager/poolManager mismatch");

        vm.startBroadcast(key);
        if (v.usdc == address(0)) {
            require(!_mainnet(), "set USDC on mainnet");
            v.usdc = address(new TestUSDC());
        }
        // amounts in the dollar token's own decimals (6 for USDC/USDG, 18 on BNB)
        uint256 dollar = 10 ** IERC20Metadata(v.usdc).decimals();
        // launch market cap for the whole supply ("test" = $450 so testnet money goes further)
        // Launch market cap in whole dollars: START_MC (mainnet default $2,000), $450 on test curves
        uint256 startUsd = testCurve ? 450 : vm.envOr("START_MC", uint256(2000));
        require(startUsd >= 450 && startUsd <= 100_000, "START_MC must be between 450 and 100000 (dollars)");
        uint256 startMarketCap = startUsd * dollar;
        // All platform fees go to the fee vault: the treasury wallet owns it and withdraws any time;
        // the relayer may only pay referral rewards from it, capped per day.
        // testnets fall back to the deployer; mainnet must name the relayer explicitly
        address payer = vm.envOr("RELAYER", deployer);
        if (_mainnet()) {
            require(vm.envOr("RELAYER", address(0)) != address(0), "mainnet: set RELAYER (the relayer's address)");
        }
        uint256 cap = vm.envOr("VAULT_DAILY_CAP", uint256(500)) * dollar;
        PadFeeVault vault = new PadFeeVault(IERC20(v.usdc), treasury, payer, cap);
        uint64 nonce = vm.getNonce(deployer);
        address builderAddr = vm.computeCreateAddress(deployer, nonce);
        bytes32 salt = _mine(builderAddr, v.poolManager, builderAddr);
        PadPoolBuilder builder = new PadPoolBuilder(
            IPoolManager(v.poolManager), IPositionManager(v.positionManager), IAllowanceTransfer(PERMIT2), IERC20(v.usdc), salt
        );
        require(address(builder) == builderAddr, "builder address");
        // The hub starts with the deployer as admin so it can wire things; admin moves below.
        // every launch includes a creator buy of at least $5 (MIN_LAUNCH_BUY, whole dollars)
        uint256 minLaunchBuy = vm.envOr("MIN_LAUNCH_BUY", uint256(5)) * dollar;
        // review L-01: never deploy with a first buy under $5
        require(minLaunchBuy >= 5 * dollar, "MIN_LAUNCH_BUY must be at least 5 (dollars)");
        PadHub hub = new PadHub(IERC20(v.usdc), builder, startMarketCap, minLaunchBuy, deployer, address(vault));
        builder.bindHub(IPadHub(address(hub)));
        PadPromote promote = new PadPromote(IERC20(v.usdc), admin, address(vault));
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
        vm.serializeAddress(o, "vault", address(vault));
        string memory json = vm.serializeAddress(o, "admin", admin);
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));

        console2.log("vault      ", address(vault));
        console2.log("hub        ", address(hub));
        console2.log("poolBuilder", address(builder));
        console2.log("promote    ", address(promote));
        console2.log("router     ", address(router));
        console2.log("usdc       ", v.usdc);
        if (admin != deployer) console2.log("ADMIN must call hub.acceptAdmin():", admin);
    }
}
