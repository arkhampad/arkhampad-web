# ArkhamPad contracts

| Contract | What it does |
| --- | --- |
| `PadHub` | Creates coins and opens each coin's Uniswap pool in the same transaction, with a creator buy of at least $5 (the pool's first trade). Admin can set treasury/guardian and pause new launches; it can never move user funds or stop trading. |
| `ArkhamPadCoin` (PadCoin.sol) | Fixed 1B supply, no owner, no mint. Optional creator lock (none / 1h / 24h). |
| `PadPoolBuilder` | Opens every coin straight into a Uniswap v4 coin/USDC pool at a $4.5K market cap. The whole supply is one liquidity position locked forever. Pool fees: 70% treasury, 30% coin (creator, or buyback & burn). |
| `PadLaunchHook` | Uniswap v4 hook: only the pool builder can open these pools; trading fee 30% at launch, falling to 2% over five minutes (anti-sniper), then 2% forever. |
| `PadRouter` | Gasless launch, buy and sell (users sign, the relayer pays gas and is repaid in USDC). |
| `PadPromote` | Pay USDC to show any coin in the Promoted row (6h $10, 24h $20, 7d $99). |
| `TestUSDC` | Testnet-only dollar (Robinhood testnet). |

Fees: every trade in a coin's pool, from any app, pays the pool fee (30% → 2% in the first five minutes, then 2%): 70% to the platform, 30% to the coin (paid to the creator or used for buyback & burn). The creator's launch buy always pays 2%.

Run the tests: GitHub → Actions → **Contracts** → Run workflow.

Tests run three ways: unit tests, the full flow on a local copy of Uniswap v4, and the same flow on real-network forks of Base Sepolia, Base and Robinhood testnet (needs the RPC secrets).

Deploy: `forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast` with PRIVATE_KEY, ADMIN, TREASURY (and CURVE=test on testnets: coins open at a $450 market cap). Addresses are written to `deployments/<chainId>.json`.
