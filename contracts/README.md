# ArkhamPad contracts

| Contract | What it does |
| --- | --- |
| `PadHub` | Creates coins (free). Optional creator buy in the same transaction. Admin can set treasury/guardian and pause new buys; it can never move user funds. |
| `PadCurve` | One coin's USDC bonding curve. Starts at $4.5K market cap, fills at $7.5K, then anyone calls `graduate()`. |
| `PadCoin` | Fixed 1B supply, no owner, no mint. Optional creator lock (none / 1h / 24h). |
| `PadPromote` | Pay USDC to show any coin in the Promoted row (6h $10, 24h $20, 7d $99). |
| `PadPoolBuilder` | At graduation opens a Uniswap v4 coin/USDC pool (1% fee) with full-range liquidity locked forever. Pool fees: 70% treasury, 30% coin (creator, or buyback & burn). |
| `PadInitGuard` | Uniswap v4 hook that lets only the pool builder open these pools, so nobody can open one early at a bad price. |
| `TestUSDC` | Testnet-only dollar (Robinhood testnet). |

Fees (USDC): 1% per trade on the curve (70% platform, 30% coin: paid to the creator or used for buyback & burn); the creator's own launch buy pays 100% to the platform; 2% of the curve's USDC at graduation.


Run the tests: GitHub → Actions → **Contracts** → Run workflow.

Tests run three ways: unit tests, the full flow on a local copy of Uniswap v4, and the same flow on real-network forks of Base Sepolia, Base and Robinhood testnet (needs the RPC secrets).

Deploy: `forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast` with PRIVATE_KEY, ADMIN, TREASURY (and CURVE=test on testnets). Addresses are written to `deployments/<chainId>.json`.
