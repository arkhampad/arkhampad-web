// Base: coins that were not launched here (Uniswap v3 and Aerodrome Slipstream pools paired with ETH), listed from
// GeckoTerminal's pool lists and then checked on chain before they are added:
//   - the pool must come from the official Uniswap v3 factory or the official Aerodrome Slipstream factory
//   - one side must be WETH (the price is then ETH per coin, like every other Base coin)
//   - enough liquidity (BASE_EXT_MIN_LIQ, default 10,000 USD)
// A listed coin joins the engine's fast lane: its pool's Swap events are read (trades, chart, volume, price) and it is
// bought / sold through ArkhamRouter like any v3 coin. Holders are not scanned for these coins (they started long before us).
// Uniswap v2 / Aerodrome v2 and v4 pools are not listed yet.

import { makeRpc } from "./elysium.mjs";

export const WETH = "0x4200000000000000000000000000000000000006";
export const EXT_PADS = ["Uniswap v3", "Aerodrome", "Uniswap v4", "Clanker"];
const ZERO = "0x0000000000000000000000000000000000000000";
const PM = "0x498581ff718922c3f8e6a244956af099b2652b2b"; // Uniswap v4 PoolManager on Base
const V4_INIT = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
const hex = (n) => "0x" + n.toString(16);
const FACTORIES = {
  "0x33128a8fc17869897dce68ed026d694621f6fdfd": "Uniswap v3",
  "0x5e7bb104d84c7cb9b682aac2f3d509f5f406809a": "Aerodrome",
};
const SEL = { token0: "0x0dfe1681", token1: "0xd21220a7", fee: "0xddca3f43", tickSpacing: "0xd0c93a7c", factory: "0xc45a0155", slot0: "0x3850c7bd" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GT = "https://api.geckoterminal.com/api/v2/networks/base";

export async function baseExternalLoop({ rpcUrls, ely, store, log = console.log, minLiq = 10_000, max = 500 }) {
  const rpc = makeRpc(rpcUrls, () => {}, true);
  // Clanker's fee hooks (a v4 pool with one of them is a Clanker coin); the list comes from the official SDK when it is installed
  const clankerHooks = new Set();
  try {
    const { clankerConfigFor } = await import("clanker-sdk");
    for (const [k, v] of Object.entries(clankerConfigFor(8453, "clanker_v4")?.related || {})) if (/hook/i.test(k) && typeof v === "string") clankerHooks.add(v.toLowerCase());
  } catch {}
  const blockTs = async (b) => Number((await rpc("eth_getBlockByNumber", [hex(b), false])).timestamp);
  // block of a given time (Base: one block every 2 s, so a few corrections land within a handful of blocks)
  async function blockAt(ts, tip) {
    let b = Math.min(tip, Math.max(1, tip - Math.round((Date.now() / 1000 - ts) / 2)));
    for (let i = 0; i < 4; i++) { const t = await blockTs(b); const d = Math.round((ts - t) / 2); if (Math.abs(d) < 2) break; b = Math.min(tip, Math.max(1, b + d)); }
    return b;
  }
  const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
  const addrOf = (r) => "0x" + r.slice(-40).toLowerCase();
  const num = (r) => Number(BigInt(r));
  const signed24 = (r) => { let v = BigInt("0x" + r.slice(-6)); if (v >= 1n << 23n) v -= 1n << 24n; return Number(v); };

  async function fetchJson(url) {
    const r = await fetch(url, { headers: { accept: "application/json;version=20230302" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`${r.status} ${url.split("?")[0].split("/").pop()}`);
    return r.json();
  }

  // pool candidates, best volume first (then trending and brand-new pools)
  async function candidates() {
    const out = new Map();
    const pages = [];
    for (let p = 1; p <= 10; p++) pages.push(`/pools?page=${p}&sort=h24_volume_usd_desc`);
    for (const dex of ["uniswap-v3-base", "aerodrome-slipstream", "uniswap-v4-base"]) for (let p = 1; p <= 10; p++) pages.push(`/dexes/${dex}/pools?page=${p}&sort=h24_volume_usd_desc`);
    for (let p = 1; p <= 3; p++) pages.push(`/trending_pools?page=${p}`, `/new_pools?page=${p}`);
    for (const path of pages) {
      try {
        const j = await fetchJson(GT + path);
        for (const d of j.data || []) {
          const a = d.attributes || {};
          const pool = String(a.address || "").toLowerCase();
          if (!/^0x([0-9a-f]{40}|[0-9a-f]{64})$/.test(pool) || out.has(pool)) continue;
          out.set(pool, { pool, dex: d.relationships?.dex?.data?.id || "", liq: Number(a.reserve_in_usd) || 0, createdAt: a.pool_created_at || null });
        }
      } catch (e) { log(`base: external list ${path.split("?")[0]} ${e.message}`); }
      await sleep(2500); // GeckoTerminal's free limit is 30 calls a minute
    }
    return [...out.values()];
  }

  const checked = new Map(); // pool -> time of the last check that said no
  async function consider(c, tip) {
    if (c.liq < minLiq) return false;
    if (c.dex && !/v3|slipstream|aerodrome|uniswap/i.test(c.dex)) return false;
    if (Date.now() - (checked.get(c.pool) || 0) < 6 * 3600_000) return false;
    const no = () => { checked.set(c.pool, Date.now()); return false; };
    if (c.pool.length === 66) return considerV4(c, tip, no);
    try {
      const pad = FACTORIES[addrOf(await call(c.pool, SEL.factory))];
      if (!pad) return no();
      const [t0, t1] = (await Promise.all([call(c.pool, SEL.token0), call(c.pool, SEL.token1)])).map(addrOf);
      if (t0 !== WETH && t1 !== WETH) return no();
      const tokenIs0 = t0 !== WETH;
      const token = tokenIs0 ? t0 : t1;
      const known = store.tokens().get(token);
      if (known && known.pool) return no();
      const [fee, spacing, s0] = await Promise.all([call(c.pool, SEL.fee), call(c.pool, SEL.tickSpacing), call(c.pool, SEL.slot0)]);
      const sqrt = BigInt("0x" + s0.slice(2, 66));
      if (sqrt === 0n) return no();
      await ely.addExternal({ token, hype: WETH, venue: "v3", pool: c.pool, manager: Object.keys(FACTORIES).find((k) => FACTORIES[k] === pad), fee: num(fee), tickSpacing: signed24(spacing), hooks: null, tokenIs0, block: tip, tx: null, sqrt, launchpad: pad, createdAt: c.createdAt });
      return true;
    } catch (e) { log(`base: external ${c.pool} ${e.message}`); return false; }
  }

  // the last 12 hours of each coin's swaps, once per pool (so volume, change and the chart are not empty on day one)
  const BACK = Number(process.env.BASE_EXT_BACK || 21_600); // Base blocks are 2 s
  async function backfill(tip) {
    for (const t of [...store.tokens().values()].filter((x) => EXT_PADS.includes(x.launchpad) && x.pool)) {
      const key = `ext_bf_${t.pool}`;
      if (await store.getState(key)) continue;
      try {
        for (let from = tip - BACK; from <= tip; from += 1000) await ely.backfillPool(t, from, Math.min(tip, from + 999));
        await store.setState(key, 1);
      } catch (e) { log(`base: external history ${t.symbol || t.pool} ${e.message}`); }
    }
  }

  // Uniswap v4 (and Clanker) pool: its id is the "address" GeckoTerminal gives; the pool's settings are in the Initialize log of the PoolManager
  async function considerV4(c, tip, no) {
    try {
      if (!c.createdAt) return no();
      const blk = await blockAt(Date.parse(c.createdAt) / 1000, tip);
      const logs = await rpc("eth_getLogs", [{ address: PM, topics: [V4_INIT, c.pool], fromBlock: hex(Math.max(1, blk - 4000)), toBlock: hex(Math.min(tip, blk + 4000)) }]);
      const l = logs[0];
      if (!l) return no();
      const c0 = addrOf(l.topics[2]), c1 = addrOf(l.topics[3]);
      const isQ = (a) => a === ZERO || a === WETH;
      const quote = isQ(c0) ? c0 : isQ(c1) ? c1 : null;
      if (!quote) return no();
      const tokenIs0 = quote === c1;
      const token = tokenIs0 ? c0 : c1;
      const known = store.tokens().get(token);
      if (known && known.pool) return no();
      const w = (i) => l.data.slice(2 + i * 64, 2 + (i + 1) * 64);
      const hooks = addrOf(w(2));
      const sqrt = BigInt("0x" + w(3));
      if (sqrt === 0n) return no();
      await ely.addExternal({ token, hype: quote, venue: "v4", pool: c.pool, manager: PM, fee: num("0x" + w(0)), tickSpacing: signed24(w(1)), hooks: hooks === ZERO ? null : hooks, tokenIs0, block: Number(BigInt(l.blockNumber)), tx: l.transactionHash, sqrt, launchpad: clankerHooks.has(hooks) ? "Clanker" : "Uniswap v4", createdAt: c.createdAt });
      return true;
    } catch (e) { log(`base: external v4 ${c.pool.slice(0, 12)} ${e.message}`); return false; }
  }

  for (;;) {
    try {
      const have = () => [...store.tokens().values()].filter((t) => EXT_PADS.includes(t.launchpad)).length;
      const tip = Number(BigInt(await rpc("eth_blockNumber")));
      let added = 0;
      for (const c of await candidates()) {
        if (have() >= max) break;
        if (await consider(c, tip)) added++;
      }
      await backfill(tip);
      log(`base: external coins ${have()} listed (+${added})`);
    } catch (e) { log(`base: external ${e.message}`); }
    await sleep(30 * 60_000);
  }
}
