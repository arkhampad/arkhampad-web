# ArkhamPad indexer

Reads coin launches, curve trades, graduations and promotions from each chain in
`chains.json` and writes them to the Supabase Postgres database.

Railway service settings:
- Root directory: `indexer`
- Start command: `npm start`
- Variables: `DATABASE_URL` (Supabase connection string), `BASE_SEPOLIA_RPC`, `ROBINHOOD_TESTNET_RPC`

Run `db/001_schema.sql` in Supabase once before the first start.

## Network fee, limits and gas alerts (Railway variables, all optional)
- Network fee: worked out live from the relayer's real gas cost. `FEE_MARGIN` (default 1.25), `FEE_MIN_USD` (0.01), `FEE_MAX_USD` (1.00; above this the network counts as busy), `FEE_ACCEPT` (0.7).
- Volume limits (mainnet only by default): `LIMIT_TRADE_USD` (500), `LIMIT_USER_DAY_USD` (2000), `LIMIT_DAY_USD` (50000); `0` turns one off. `LIMITS_ON` = `mainnet` (default), `all` (also testnets) or `off`.
- Relayer gas alert: `ALERT_WALLET` (your ArkhamPad wallet address: alert in the bell + push), `LOW_GAS_ETH` (0.005), `LOW_GAS_BNB` (0.03), `LOW_GAS_TESTNET` (0.0002, used on testnets). The status page (`/`) shows the relayer's gas per network.

