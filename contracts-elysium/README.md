# ArkhamPad on Elysium

`ArkhamV3Launcher` launches a coin in one transaction: fixed 1B supply, all of it into a coin/WHYPE
Uniswap v3 pool as one-sided liquidity at the start market cap, the position locked in the launcher
forever, and the creator's first buy made straight against the pool. The pool fee (1%) is the
trading fee; `collect(coin)` splits it between ArkhamPad's treasury and the creator (30%).

Elysium has no shared Uniswap yet, so `script/DeployAll.s.sol` deploys our own: WHYPE, Uniswap v3
factory, position manager, swap router and quoter (official npm artifacts in `v3/`), then the
launcher and one smoke-test coin. Addresses land in `deployments/99901.json`.

Tests: `forge test`. Deploy: GitHub Actions "Elysium" (bridge HYPE in, then deploy).
