// Quality list for coins from other DEXs.
//
// 1. Safety (GoPlus, free): for each coin, can it actually be sold, and what
//    are its buy/sell taxes. Busiest coins first; rechecked weekly.
// 2. Attention (DexScreener, free): coins whose team or community made a
//    DexScreener profile or bought a boost, the closest free signal to "people
//    are talking about it". New ones on our chains are added.
// 3. Listing: every few minutes, up to QUALITY_MAX coins (default 5,000) that
//    are safe, liquid and actively traded are marked `listed`, the rest are
//    not. The site's lists show listed coins only.
//
// Env (all optional): QUALITY_MAX (5000), QUALITY_MIN_LIQ (2000),
// QUALITY_MIN_VOL (1000), QUALITY_ACTIVE_HOURS (24), QUALITY_OFF=1.

import { upsertTokens } from "./markets.mjs";

const GOPLUS = "https://api.gopluslabs.io/api/v1/token_security";
const DS = "https://api.dexscreener.com";
const log = (...a) => console.log(new Date().toISOString(), "quality:", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Chains GoPlus checks. Coins on other chains are listed on liquidity and volume alone. */
export const GOPLUS_CHAINS = [8453, 56];
/** DexScreener chain ids for the chains we list. */
export const DS_CHAINS = { base: 8453, bsc: 56, robinhood: 4663 };

export const config = () => ({
  max: Number(process.env.QUALITY_MAX ?? 5000),
  minLiq: Number(process.env.QUALITY_MIN_LIQ ?? 2000),
  minVol: Number(process.env.QUALITY_MIN_VOL ?? 1000),
  activeHours: Number(process.env.QUALITY_ACTIVE_HOURS ?? 24),
});

const flag = (v) => (v === "1" ? true : v === "0" ? false : null);
const tax = (v) => { const n = num(v); return n === null ? null : n; };

/** GoPlus result object -> our columns (null when GoPlus doesn't know). */
export function safetyOf(g) {
  if (!g || typeof g !== "object") return { honeypot: null, cannot_sell: null, buy_tax: null, sell_tax: null };
  return {
    honeypot: flag(g.is_honeypot),
    cannot_sell: flag(g.cannot_sell_all),
    buy_tax: tax(g.buy_tax),
    sell_tax: tax(g.sell_tax),
  };
}

/** The listing rule as one SQL statement (exported for tests). Parameters: $1 max, $2 minLiq, $3 minVol, $4 activeHours, $5 goplus chain ids. */
export const LIST_SQL = `
with ok as (
  select chain_id, address from ext_tokens
  where coalesce(honeypot, false) = false
    and coalesce(cannot_sell, false) = false
    and coalesce(sell_tax, 0) < 0.25
    and coalesce(buy_tax, 0) < 0.25
    and coalesce(liq_usd, 0) >= $2
    and coalesce(vol_24h, 0) >= $3
    and updated_at > now() - make_interval(hours => $4::int)
    and (gp_checked_at is not null or not (chain_id = any($5::int[])))
  order by has_profile desc, vol_24h desc nulls last
  limit $1
),
off as (
  update ext_tokens t set listed = false
  where t.listed and not exists (select 1 from ok where ok.chain_id = t.chain_id and ok.address = t.address)
  returning 1
),
onn as (
  update ext_tokens t set listed = true
  from ok where ok.chain_id = t.chain_id and ok.address = t.address and not t.listed
  returning 1
)
select (select count(*) from ok)::int as listed, (select count(*) from onn)::int as added, (select count(*) from off)::int as removed`;

async function goplus(chainId, addresses) {
  const r = await fetch(`${GOPLUS}/${chainId}?contract_addresses=${addresses.join(",")}`, { signal: AbortSignal.timeout(20_000) });
  if (r.status === 429) throw Object.assign(new Error("GoPlus rate limit"), { wait: true });
  if (!r.ok) throw new Error(`GoPlus ${r.status}`);
  const j = await r.json();
  return j?.result && typeof j.result === "object" ? j.result : {};
}

async function safetyLoop(pool) {
  for (;;) {
    let did = 0;
    for (const chainId of GOPLUS_CHAINS) {
      try {
        const { rows } = await pool.query(
          `select address from ext_tokens
           where chain_id = $1 and (gp_checked_at is null or gp_checked_at < now() - interval '7 days')
             and coalesce(liq_usd, 0) >= 500
           order by vol_24h desc nulls last limit 20`,
          [chainId],
        );
        if (!rows.length) continue;
        const addrs = rows.map((r) => r.address);
        const res = await goplus(chainId, addrs);
        for (const a of addrs) {
          const s = safetyOf(res[a] ?? res[a.toLowerCase()]);
          await pool.query(
            `update ext_tokens set gp_checked_at = now(), honeypot = $3, cannot_sell = $4, buy_tax = $5, sell_tax = $6
             where chain_id = $1 and address = $2`,
            [chainId, a, s.honeypot, s.cannot_sell, s.buy_tax, s.sell_tax],
          );
        }
        did += addrs.length;
      } catch (e) {
        log(`safety ${chainId}: ${e.message}`);
        if (e.wait) await sleep(60_000);
      }
      await sleep(2_500); // GoPlus free tier: about 30 calls a minute
    }
    if (!did) await sleep(60_000);
  }
}

/** DexScreener profile/boost lists -> { chainId, address } on our chains. */
export function attentionFrom(lists) {
  const out = new Map();
  for (const list of lists) {
    for (const t of Array.isArray(list) ? list : []) {
      const chainId = DS_CHAINS[t?.chainId];
      const address = String(t?.tokenAddress ?? "").toLowerCase();
      if (!chainId || !/^0x[0-9a-f]{40}$/.test(address)) continue;
      out.set(`${chainId}:${address}`, { chainId, address });
    }
  }
  return [...out.values()];
}

/** DexScreener pairs of a token -> a new ext_tokens row (deepest pair), or null. */
export function rowFromPairs(chainId, network, address, pairs) {
  let best = null;
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (String(p?.baseToken?.address ?? "").toLowerCase() !== address) continue;
    if (!best || (num(p?.liquidity?.usd) ?? 0) > (num(best?.liquidity?.usd) ?? 0)) best = p;
  }
  if (!best) return null;
  const symbol = String(best.baseToken?.symbol ?? "").trim().slice(0, 24);
  if (!symbol) return null;
  return {
    chain_id: chainId, address, network,
    pool: String(best.pairAddress ?? "").toLowerCase() || null, dex: best.dexId ?? null,
    name: String(best.baseToken?.name ?? symbol).slice(0, 80), symbol,
    image: typeof best.info?.imageUrl === "string" && best.info.imageUrl.startsWith("https://") ? best.info.imageUrl : null,
    price_usd: num(best.priceUsd), mcap_usd: num(best.marketCap), fdv_usd: num(best.fdv),
    liq_usd: num(best.liquidity?.usd), vol_24h: num(best.volume?.h24),
    change_5m: num(best.priceChange?.m5), change_1h: num(best.priceChange?.h1), change_24h: num(best.priceChange?.h24),
    vol_1h: num(best.volume?.h1), txns_5m: null,
    buys_24h: num(best.txns?.h24?.buys), sells_24h: num(best.txns?.h24?.sells),
    pool_created: best.pairCreatedAt ? new Date(best.pairCreatedAt).toISOString() : null,
    trending_rank: null,
  };
}

async function ds(path) {
  const r = await fetch(`${DS}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`DexScreener ${r.status}`);
  return r.json();
}

async function attentionLoop(pool) {
  for (;;) {
    try {
      const lists = await Promise.all(["/token-profiles/latest/v1", "/token-boosts/latest/v1", "/token-boosts/top/v1"].map((p) => ds(p).catch(() => [])));
      const found = attentionFrom(lists);
      let added = 0;
      for (const { chainId, address } of found) {
        const u = await pool.query("update ext_tokens set has_profile = true where chain_id = $1 and address = $2", [chainId, address]);
        if (u.rowCount) continue;
        const network = Object.keys(DS_CHAINS).find((k) => DS_CHAINS[k] === chainId);
        const { rows } = await pool.query("select network from ext_tokens where chain_id = $1 limit 1", [chainId]);
        const pairs = await ds(`/tokens/v1/${network}/${address}`).catch(() => null);
        const row = rowFromPairs(chainId, rows[0]?.network ?? network, address, pairs);
        if (row && (row.liq_usd ?? 0) >= 500) {
          await upsertTokens(pool, [row]);
          await pool.query("update ext_tokens set has_profile = true where chain_id = $1 and address = $2", [chainId, address]);
          added++;
        }
        await sleep(300);
      }
      if (added) log(`added ${added} coins people are promoting on DexScreener`);
    } catch (e) {
      log(`attention: ${e.message}`);
    }
    await sleep(5 * 60_000);
  }
}

async function listLoop(pool) {
  for (;;) {
    try {
      const c = config();
      const { rows } = await pool.query(LIST_SQL, [c.max, c.minLiq, c.minVol, c.activeHours, GOPLUS_CHAINS]);
      const r = rows[0];
      log(`${r.listed} coins listed (+${r.added} / -${r.removed})`);
    } catch (e) {
      log(`list: ${e.message}`);
    }
    await sleep(5 * 60_000);
  }
}

export function startQuality(pool) {
  if (process.env.QUALITY_OFF === "1") return log("off (QUALITY_OFF=1)");
  safetyLoop(pool);
  attentionLoop(pool);
  listLoop(pool);
}
