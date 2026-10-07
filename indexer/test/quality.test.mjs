import { test } from "node:test";
import assert from "node:assert/strict";
import { safetyOf, attentionFrom, rowFromPairs, LIST_SQL, config } from "../quality.mjs";

test("GoPlus flags map to columns", () => {
  assert.deepEqual(safetyOf({ is_honeypot: "1", cannot_sell_all: "0", buy_tax: "0.05", sell_tax: "0.99" }), { honeypot: true, cannot_sell: false, buy_tax: 0.05, sell_tax: 0.99 });
  assert.deepEqual(safetyOf(undefined), { honeypot: null, cannot_sell: null, buy_tax: null, sell_tax: null });
  assert.deepEqual(safetyOf({ is_honeypot: "", buy_tax: "" }).honeypot, null);
});

test("DexScreener attention keeps our chains only, once each", () => {
  const a = "0x" + "a".repeat(40), b = "0x" + "B".repeat(40);
  const got = attentionFrom([
    [{ chainId: "base", tokenAddress: a }, { chainId: "solana", tokenAddress: "xyz" }],
    [{ chainId: "base", tokenAddress: a }, { chainId: "bsc", tokenAddress: b }, { chainId: "robinhood", tokenAddress: "bad" }],
  ]);
  assert.deepEqual(got, [{ chainId: 8453, address: a }, { chainId: 56, address: b.toLowerCase() }]);
});

test("new coin row comes from its deepest pair", () => {
  const a = "0x" + "c".repeat(40);
  const row = rowFromPairs(8453, "base", a, [
    { baseToken: { address: a, symbol: "FROG", name: "Frog" }, liquidity: { usd: 1000 }, pairAddress: "0xP1", dexId: "uni", volume: { h24: 5 } },
    { baseToken: { address: a, symbol: "FROG", name: "Frog" }, liquidity: { usd: 9000 }, pairAddress: "0xP2", dexId: "aero", volume: { h24: 50 } },
    { baseToken: { address: "0x" + "d".repeat(40), symbol: "X" }, liquidity: { usd: 99999 } },
  ]);
  assert.equal(row.pool, "0xp2");
  assert.equal(row.liq_usd, 9000);
  assert.equal(row.symbol, "FROG");
  assert.equal(rowFromPairs(8453, "base", a, []), null);
});

test("listing rule keeps the safety, liquidity, volume and activity checks", () => {
  for (const part of ["honeypot", "cannot_sell", "sell_tax", "buy_tax", "liq_usd", "vol_24h", "updated_at", "gp_checked_at", "limit $1", "has_profile desc"]) {
    assert.ok(LIST_SQL.includes(part), part);
  }
  const c = config();
  assert.equal(c.max, 5000);
  assert.equal(c.minLiq, 2000);
  assert.equal(c.minVol, 1000);
});
