// node --test test/  (needs TEST_DATABASE_URL for the database parts)
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { rowsFromPools, updatesFromPairs, upsertTokens, applyUpdates, plumbing, dedupe } from "../markets.mjs";

const NET = { id: "base", chainId: 8453 };
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const pool = (id, base, liq, extra = {}) => ({
  id, type: "pool",
  attributes: { address: id, name: "X / WETH", base_token_price_usd: "0.0012", reserve_in_usd: String(liq), fdv_usd: "1200000", market_cap_usd: null,
    volume_usd: { h24: "50000" }, price_change_percentage: { h1: "1.5", h24: "-3.2" }, transactions: { h24: { buys: 120, sells: 80 } },
    pool_created_at: "2026-10-01T10:00:00Z", ...extra },
  relationships: { base_token: { data: { id: `base_${base}`, type: "token" } }, dex: { data: { id: "uniswap-v3-base" } } },
});
const GT_JSON = {
  data: [pool("0xp1", A, 20000), pool("0xp2", A, 90000), pool("0xp3", B, 300), pool("0xp4", "0xbad", 5000), pool("0xp5", "0x3333333333333333333333333333333333333333", 9000)],
  included: [
    { id: `base_${A}`, type: "token", attributes: { symbol: "FROG", name: "Frog Coin", image_url: "https://img/frog.png" } },
    { id: `base_${B}`, type: "token", attributes: { symbol: "TINY", name: "Tiny" } },
    { id: "base_0x3333333333333333333333333333333333333333", type: "token", attributes: { symbol: "USDC", name: "USD Coin" } },
  ],
};

test("pools -> rows: keeps the deepest pool, skips tiny, broken and plumbing tokens", () => {
  const rows = rowsFromPools(GT_JSON, NET, 0);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.address, A);
  assert.equal(r.pool, "0xp2");
  assert.equal(r.liq_usd, 90000);
  assert.equal(r.symbol, "FROG");
  assert.equal(r.trending_rank, 1);
  assert.equal(r.change_24h, -3.2);
  assert.equal(r.buys_24h, 120);
});

test("plumbing filter", () => {
  for (const s of ["WETH", "USDC", "USDT0", "cbBTC", "wstETH", "crvUSD"]) assert.ok(plumbing(s, ""), s);
  for (const s of ["DEGEN", "BRETT", "TOSHI", "MFROG"]) assert.ok(!plumbing(s, ""), s);
});

test("dexscreener pairs -> deepest pair per token", () => {
  const ups = updatesFromPairs([
    { baseToken: { address: A.toUpperCase().replace("0X", "0x") }, priceUsd: "0.002", liquidity: { usd: 1000 }, volume: { h24: 10 } },
    { baseToken: { address: A }, priceUsd: "0.0021", liquidity: { usd: 50000 }, volume: { h24: 999 }, priceChange: { h1: 2, h24: 10 }, marketCap: 2100000, txns: { h24: { buys: 5, sells: 7 } }, info: { imageUrl: "https://img/a.png" } },
  ]);
  assert.equal(ups.length, 1);
  assert.equal(ups[0].price_usd, 0.0021);
  assert.equal(ups[0].vol_24h, 999);
  assert.equal(ups[0].mcap_usd, 2100000);
});

const url = process.env.TEST_DATABASE_URL;
test("database: upsert, update, spark history capped at 48", { skip: !url }, async () => {
  const db = new pg.Pool({ connectionString: url });
  await db.query("delete from ext_tokens");
  assert.equal(await upsertTokens(db, rowsFromPools(GT_JSON, NET, 0)), 1);
  assert.equal(await upsertTokens(db, rowsFromPools(GT_JSON, NET)), 1); // same token again: update, no duplicate
  for (let i = 1; i <= 60; i++) await applyUpdates(db, 8453, [{ address: A, price_usd: i / 1000, liq_usd: 1, vol_24h: i }]);
  const { rows } = await db.query("select count(*)::int n, max(cardinality(spark)) s, max(spark[cardinality(spark)]) last, max(spark[1]) first, max(vol_24h) v, max(trending_rank) tr from ext_tokens");
  assert.equal(rows[0].n, 1);
  assert.equal(rows[0].s, 48);
  assert.equal(Number(rows[0].last), 0.06);
  assert.equal(Number(rows[0].first), 0.013);
  assert.equal(Number(rows[0].v), 60);
  assert.equal(rows[0].tr, 1); // kept from the trending pass
  await db.end();
});

test("the same token twice in one batch is stored once (keeps best rank and deepest pool)", { skip: !url }, async () => {
  const db = new pg.Pool({ connectionString: url });
  await db.query("delete from ext_tokens");
  const page1 = rowsFromPools(GT_JSON, NET, 0);
  const page2 = rowsFromPools({ ...GT_JSON, data: [pool("0xp9", A, 500000)] }, NET, 20);
  assert.equal(dedupe([...page1, ...page2]).length, 1);
  assert.equal(await upsertTokens(db, [...page1, ...page2]), 1);
  const { rows } = await db.query("select pool, trending_rank from ext_tokens");
  assert.equal(rows[0].pool, "0xp9");
  assert.equal(rows[0].trending_rank, 1);
  await db.end();
});
