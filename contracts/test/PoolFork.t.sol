// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {PoolFlow} from "./PoolFlow.sol";
import {MockUSDC} from "./Mocks.sol";

/// @notice The same flow against the real Uniswap v4 contracts on each chain.
/// Skipped unless the chain's RPC env var is set (the CI sets them).
abstract contract ForkBase is PoolFlow {
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bool internal on;
    bool internal realUsdc;

    function _setup(string memory rpcEnv, address pm_, address posm_, address usdc_) internal {
        string memory rpc = vm.envOr(rpcEnv, string(""));
        if (bytes(rpc).length == 0) {
            // On GitHub (CI=true) a missing RPC is a setup error, not a skip.
            require(!vm.envOr("CI", false), string.concat("missing secret ", rpcEnv));
            return;
        }
        vm.createSelectFork(rpc);
        on = true;
        console2.log("forked chain", block.chainid, "at block", block.number);
        pm = IPoolManager(pm_);
        posm = IPositionManager(posm_);
        permit2 = IAllowanceTransfer(PERMIT2);
        if (usdc_ == address(0)) {
            usdc = IERC20(address(new MockUSDC()));
        } else {
            usdc = IERC20(usdc_);
            realUsdc = true;
        }
        _deployPad();
    }

    function _fund(address who, uint256 amount) internal override {
        if (realUsdc) deal(address(usdc), who, amount);
        else MockUSDC(address(usdc)).mint(who, amount);
    }

    function test_graduateTradeCollect() public { if (on) _flow_graduateTradeCollect(); }
    function test_buybackBurn() public { if (on) _flow_buybackBurn(); }
    function test_guardBlocksEarlyPool() public { if (on) _flow_guardBlocksEarlyPool(); }
    function test_gasless() public { if (on) _flow_gasless(); }
    function test_gaslessPool() public { if (on) _flow_gaslessPool(); }
    function test_poolNeedsGraduation() public { if (on) _flow_poolNeedsGraduation(); }
    function test_callbacksLocked() public { if (on) _flow_callbacksLocked(); }
    function test_routerSweep() public { if (on) _flow_routerSweep(); }
    function test_builderStrayUsdc() public { if (on) _flow_builderStrayUsdc(); }
}

contract BaseSepoliaForkTest is ForkBase {
    function setUp() public {
        _setup("BASE_SEPOLIA_RPC", 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408, 0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80, 0x036CbD53842c5426634e7929541eC2318f3dCF7e);
    }
}

contract BaseMainnetForkTest is ForkBase {
    function setUp() public {
        _setup("BASE_RPC", 0x498581fF718922c3f8e6A244956aF099B2652b2b, 0x7C5f5A4bBd8fD63184577525326123B519429bDc, 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);
    }
}

contract RobinhoodTestnetForkTest is ForkBase {
    function setUp() public {
        _setup("ROBINHOOD_TESTNET_RPC", 0x8366a39CC670B4001A1121B8F6A443A643e40951, 0x58daec3116aae6D93017bAAea7749052E8a04fA7, address(0));
    }
}

/// Robinhood Chain mainnet with its real dollar (USDG): gasless permit, trading, graduation into the real Uniswap v4.
contract RobinhoodMainnetForkTest is ForkBase {
    function setUp() public {
        _setup("ROBINHOOD_RPC", 0x8366a39CC670B4001A1121B8F6A443A643e40951, 0x58daec3116aae6D93017bAAea7749052E8a04fA7, 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    }
}

/// BNB Chain mainnet: 18-decimal USDC without permit (users approve once, with gas the relayer tops up),
/// trading, graduation into the real Uniswap v4.
contract BnbMainnetForkTest is ForkBase {
    function setUp() public {
        _setup("BNB_RPC", 0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF, 0x7A4a5c919aE2541AeD11041A1AEeE68f1287f95b, 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d);
    }
}
