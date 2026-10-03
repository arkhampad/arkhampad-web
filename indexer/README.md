# ArkhamPad indexer

Reads coin launches, curve trades, graduations and promotions from each chain in
`chains.json` and writes them to the Supabase Postgres database.

Railway service settings:
- Root directory: `indexer`
- Start command: `npm start`
- Variables: `DATABASE_URL` (Supabase connection string), `BASE_SEPOLIA_RPC`, `ROBINHOOD_TESTNET_RPC`

Run `db/001_schema.sql` in Supabase once before the first start.
