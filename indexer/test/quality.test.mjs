import { test } from "node:test";
import assert from "node:assert/strict";
import { safetyOf, socialsOf, routeFairness, attentionFrom, rowFromPairs, LIST_SQL, config, RULES } from "../quality.mjs";

test("GoPlus flags map to columns", () => {
  const s = safetyOf({ is_honeypot: "1", cannot_sell_all: "0", buy_tax: "0.05", sell_tax: "0.99", owner_address: "", creator_percent: "0.02", holders: [] });
  assert.equal(s.honeypot, true); assert.equal(s.cannot_sell, false); assert.equal(s.buy_tax, 0.05); assert.equal(s.sell_tax, 0.99);
  assert.equal(s.owner_risk, false); assert.equal(s.creator_pct, 0.02); assert.equal(s.top10_pct, 0);
  // unknown stays unknown (and unknown is never listed)
  assert.deepEqual(safetyOf(undefined), { honeypot: null, cannot_sell: null, buy_tax: null, sell_tax: null, owner_risk: null, top10_pct: null, creator_pct: null });
  assert.equal(safetyOf({ is_honeypot: "", buy_tax: "" }).honeypot, null);
  assert.equal(safetyOf({ is_honeypot: "0", buy_tax: "" }).buy_tax, null);
});

test("owner powers count only while someone owns the coin; hidden tricks always count", () => {
  const live = "0x" + "1".repeat(40);
  assert.equal(safetyOf({ is_honeypot: "0", is_mintable: "1", owner_address: live }).owner_risk, true);
  assert.equal(safetyOf({ is_honeypot: "0", is_mintable: "1", owner_address: "0x0000000000000000000000000000000000000000" }).owner_risk, false);
  assert.equal(safetyOf({ is_honeypot: "0", transfer_pausable: "1", owner_address: "0x000000000000000000000000000000000000dEaD" }).owner_risk, false);
  assert.equal(safetyOf({ is_honeypot: "0", is_blacklisted: "1", owner_address: live }).owner_risk, true);
  assert.equal(safetyOf({ is_honeypot: "0", slippage_modifiable: "1", owner_address: live }).owner_risk, true);
  assert.equal(safetyOf({ is_honeypot: "0", hidden_owner: "1", owner_address: "" }).owner_risk, true);
  assert.equal(safetyOf({ is_honeypot: "0", owner_change_balance: "1", owner_address: "" }).owner_risk, true);
});

test("top 10 wallets leave out pools, locks and burn addresses", () => {
  const h = (address, percent, extra = {}) => ({ address, percent: String(percent), is_contract: 0, is_locked: 0, ...extra });
  const holders = [
    h("0x" + "a".repeat(40), 0.4, { is_contract: 1 }), // the pool
    h("0x000000000000000000000000000000000000dead", 0.3),
    h("0x" + "b".repeat(40), 0.2, { is_locked: 1 }),
    h("0x" + "c".repeat(40), 0.05), h("0x" + "d".repeat(40), 0.03),
  ];
  assert.ok(Math.abs(safetyOf({ is_honeypot: "0", holders }).top10_pct - 0.08) < 1e-9);
});

test("socials: an X account or a website counts, a Telegram alone doesn't", () => {
  const a = "0x" + "e".repeat(40);
  const pair = (info) => [{ baseToken: { address: a }, info }];
  assert.equal(socialsOf(pair({ socials: [{ type: "twitter", url: "https://x.com/coin" }] }), a), true);
  assert.equal(socialsOf(pair({ websites: [{ label: "Website", url: "https://coin.xyz" }] }), a), true);
  assert.equal(socialsOf(pair({ socials: [{ type: "telegram", url: "https://t.me/coin" }] }), a), false);
  assert.equal(socialsOf(pair(undefined), a), false);
  assert.equal(socialsOf([{ baseToken: { address: "0x" + "f".repeat(40) }, info: { websites: [{ url: "https://x.y" }] } }], a), false);
});

test("route check: a route that only reaches an empty pool fails", () => {
  // Samur•ai: market $0.0000002095, the route paid cents for $35 of coins
  const price = 2.095e-7, decimals = 18, usdcDec = 6, usd = 50;
  const coins = (n) => BigInt(Math.floor(n)) * 10n ** 18n;
  const fair = routeFairness({ usd, price, decimals, usdcDec, coinsOut: coins((49 / price)), coinsSold: coins(usd / price), usdcOut: 48_500_000n });
  assert.ok(fair >= RULES.routeFloor, String(fair));
  const bad = routeFairness({ usd, price, decimals, usdcDec, coinsOut: coins((49 / price)), coinsSold: coins(usd / price), usdcOut: 50_000n });
  assert.ok(bad < RULES.routeFloor, String(bad));
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

test("listing rule keeps every check", () => {
  for (const part of ["honeypot is false", "cannot_sell", "sell_tax is not null", "buy_tax is not null", "owner_risk is false", "top10_pct", "creator_pct", "has_socials is true", "route_ok is true", "pool_created", "liq_usd", "vol_24h", "updated_at", "gp_checked_at is not null", "has_profile", "limit $1"]) {
    assert.ok(LIST_SQL.includes(part), part);
  }
  const c = config();
  assert.equal(c.max, 5000);
  assert.equal(c.minLiq, 10000);
  assert.equal(c.minVol, 5000);
  assert.equal(c.minAgeHours, 24);
  assert.deepEqual([RULES.maxTax, RULES.maxTop10, RULES.maxCreator], [0.05, 0.5, 0.1]);
});
