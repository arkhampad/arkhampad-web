# ArkhamPad contracts

| Contract | What it does |
| --- | --- |
| `PadHub` | Creates coins (free). Optional creator buy in the same transaction. Admin can set treasury/guardian and pause new buys; it can never move user funds. |
| `PadCurve` | One coin's USDC bonding curve. Starts at $4.5K market cap, fills at $7.5K, then anyone calls `graduate()`. |
| `PadCoin` | Fixed 1B supply, no owner, no mint. Optional creator lock (none / 1h / 24h). |
| `PadPromote` | Pay USDC to show any coin in the Promoted row (6h $10, 24h $20, 7d $99). |

Fees (USDC): 1% per trade on the curve (70% platform, 30% coin: paid to the creator or used for buyback & burn); the creator's own launch buy pays 100% to the platform; 2% of the curve's USDC at graduation.

The pool builder (graduation into locked DEX liquidity with 1% pool fee, 70/30 split) comes in the next package.

Run the tests: GitHub → Actions → **Contracts** → Run workflow.
