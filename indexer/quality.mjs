// Quality list for coins from other DEXs. Strict on purpose: a coin is listed (and can be
// bought on ArkhamPad) only when every check below passes. Anything unknown counts as unsafe.
//
// 1. Safety (GoPlus, free): it can be sold, buy/sell tax under 5%, the owner can't mint, pause,
//    blacklist, change taxes or balances (or has given up control), no hidden owner, the 10
//    biggest wallets hold under 50% (pools, locks and burn addresses left out), the creator
//    under 10%. Rechecked daily.
// 2. Socials (DexScreener, free): the coin has an X account or a website.
// 3. Age: its pool is at least 24 hours old (most rugs happen in the first hours).
// 4. Market: liquidity at least $10K, volume at least $5K in 24 h, traded in the last day.
// 5. Route (KyberSwap): $50 can be bought and sold within 10% of the market price.
//    A coin whose route only reaches a nearly empty pool is never listed. Rechecked every 3 h.
// 6. Robinhood (GoPlus doesn't cover it): only coins with a DexScreener profile, plus 2-5.
// Every few minutes up to QUALITY_MAX coins that pass are `listed`; the rest are not.
// Unlisted coins can't be bought on ArkhamPad (site and relayer); holders can always sell.
//
// Env (all optional): QUALITY_MAX (5000), QUALITY_MIN_LIQ (10000), QUALITY_MIN_VOL (5000),
// QUALITY_ACTIVE_HOURS (24), QUALITY_MIN_AGE_HOURS (24), QUALITY_OFF=1.

import { createPublicClient, http, parseAbi } from "viem";
import { upsertTokens } from "./markets.mjs";

const GOPLUS = "https://api.gopluslabs.io/api/v1/token_security";
const DS = "https://api.dexscreener.com";
const KYBER = "https://aggregator-api.kyberswap.com";
const log = (...a) => console.log(new Date().toISOString(), "quality:", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Chains GoPlus checks. On other chains a coin also needs a DexScreener profile. */
export const GOPLUS_CHAINS = [8453, 56];
/** DexScreener (and KyberSwap) chain ids for the chains we list. */
export const DS_CHAINS = { base: 8453, bsc: 56, robinhood: 4663 };
const SLUG = Object.fromEntries(Object.entries(DS_CHAINS).map(([k, v]) => [v, k]));

export const config = () => ({
  max: Number(process.env.QUALITY_MAX ?? 5000),
  minLiq: Number(process.env.QUALITY_MIN_LIQ ?? 10000),
  minVol: Number(process.env.QUALITY_MIN_VOL ?? 5000),
  activeHours: Number(process.env.QUALITY_ACTIVE_HOURS ?? 24),
  minAgeHours: Number(process.env.QUALITY_MIN_AGE_HOURS ?? 24),
});
export const RULES = { maxTax: 0.05, maxTop10: 0.5, maxCreator: 0.1, routeFloor: 0.9, routeUsd: 50 };

const flag = (v) => (v === "1" || v === 1 ? true : v === "0" || v === 0 ? false : null);
const tax = (v) => (v === "" || v === undefined || v === null ? null : num(v));
/** No live owner: empty, not an address, the zero address or a burn address. */
const isDead = (a) => { const s = String(a ?? "").toLowerCase(); return !/^0x[0-9a-f]{40}$/.test(s) || /^0x0{40}$/.test(s) || /^0x0{36}dead$/.test(s); };

/** GoPlus result object -> our columns (null when GoPlus doesn't know). */
export function safetyOf(g) {
  const none = { honeypot: null, cannot_sell: null, buy_tax: null, sell_tax: null, owner_risk: null, top10_pct: null, creator_pct: null };
  if (!g || typeof g !== "object" || !Object.keys(g).length) return none;
  const ownerLive = !isDead(g.owner_address);
  const always = ["hidden_owner", "owner_change_balance", "can_take_back_ownership", "selfdestruct"].some((k) => flag(g[k]) === true);
  const ownerPowers = ["is_mintable", "transfer_pausable", "is_blacklisted", "slippage_modifiable", "personal_slippage_modifiable", "trading_cooldown"].some((k) => flag(g[k]) === true);
  // the 10 biggest wallets, leaving out pools/contracts, locked holdings and burn addresses
  let top10 = null;
  if (Array.isArray(g.holders)) {
    top10 = g.holders.filter((h) => flag(h?.is_contract) !== true && flag(h?.is_locked) !== true && !isDead(h?.address))
      .slice(0, 10).reduce((s, h) => s + (num(h?.percent) ?? 0), 0);
  }
  return {
    honeypot: flag(g.is_honeypot),
    cannot_sell: flag(g.cannot_sell_all),
    buy_tax: tax(g.buy_tax),
    sell_tax: tax(g.sell_tax),
    owner_risk: always || (ownerLive && ownerPowers),
    top10_pct: top10,
    creator_pct: tax(g.creator_percent),
  };
}

/** DexScreener pairs -> does the coin show an X account or a website? */
export function socialsOf(pairs, address) {
  let any = false;
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (String(p?.baseToken?.address ?? "").toLowerCase() !== address) continue;
    const web = (p?.info?.websites ?? []).some((w) => /^https?:\/\//i.test(String(w?.url ?? "")));
    const x = (p?.info?.socials ?? []).some((s) => /^(twitter|x)$/i.test(String(s?.type ?? "")) || /(?:twitter|x)\.com\//i.test(String(s?.url ?? "")));
    if (web || x) any = true;
  }
  return any;
}

/** The listing rule as one SQL statement (exported for tests).
 *  $1 max, $2 minLiq, $3 minVol, $4 activeHours, $5 goplus chain ids, $6 minAgeHours,
 *  $7 maxTax, $8 maxTop10, $9 maxCreator */
export const LIST_SQL = `
with ok as (
  select chain_id, address from ext_tokens
  where coalesce(liq_usd, 0) >= $2
    and coalesce(vol_24h, 0) >= $3
    and updated_at > now() - make_interval(hours => $4::int)
    and coalesce(pool_created, first_seen) < now() - make_interval(hours => $6::int)
    and has_socials is true
    and route_ok is true and route_checked_at > now() - interval '12 hours'
    and (
      (chain_id = any($5::int[])
        and gp_checked_at is not null
        and honeypot is false
        and coalesce(cannot_sell, false) = false
        and sell_tax is not null and sell_tax < $7
        and buy_tax is not null and buy_tax < $7
        and owner_risk is false
        and top10_pct is not null and top10_pct < $8
        and coalesce(creator_pct, 0) < $9)
      or (not (chain_id = any($5::int[])) and has_profile)
    )
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

/** Coins worth checking: they already meet the market rules (cheap checks first). */
const CANDIDATES = `coalesce(liq_usd, 0) >= $2 and coalesce(vol_24h, 0) >= $3 and updated_at > now() - interval '24 hours'`;

export async function goplus(chainId, addresses) {
  const r = await fetch(`${GOPLUS}/${chainId}?contract_addresses=${addresses.join(",")}`, { signal: AbortSignal.timeout(20_000) });
  if (r.status === 429) throw Object.assign(new Error("GoPlus rate limit"), { wait: true });
  if (!r.ok) throw new Error(`GoPlus ${r.status}`);
  const j = await r.json();
  return j?.result && typeof j.result === "object" ? j.result : {};
}

async function safetyLoop(pool) {
  for (;;) {
    let did = 0;
    const c = config();
    for (const chainId of GOPLUS_CHAINS) {
      try {
        // coins that meet the market rules, rechecked daily (taxes and owners can change)
        const { rows } = await pool.query(
          `select address from ext_tokens
           where chain_id = $1 and ${CANDIDATES}
             and (gp_checked_at is null or gp_checked_at < now() - interval '24 hours')
           order by gp_checked_at asc nulls first, vol_24h desc nulls last limit 20`,
          [chainId, c.minLiq, c.minVol],
        );
        if (!rows.length) continue;
        const addrs = rows.map((r) => r.address);
        const res = await goplus(chainId, addrs);
        for (const a of addrs) {
          const s = safetyOf(res[a] ?? res[a.toLowerCase()]);
          await pool.query(
            `update ext_tokens set gp_checked_at = now(), honeypot = $3, cannot_sell = $4, buy_tax = $5, sell_tax = $6,
               owner_risk = $7, top10_pct = $8, creator_pct = $9
             where chain_id = $1 and address = $2`,
            [chainId, a, s.honeypot, s.cannot_sell, s.buy_tax, s.sell_tax, s.owner_risk, s.top10_pct, s.creator_pct],
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

/** X account / website from DexScreener, 30 coins per call, rechecked every 12 h. */
async function socialsLoop(pool) {
  for (;;) {
    let did = 0;
    const c = config();
    for (const [chainId, slug] of Object.entries(SLUG)) {
      try {
        const { rows } = await pool.query(
          `select address from ext_tokens
           where chain_id = $1 and ${CANDIDATES}
             and (socials_checked_at is null or socials_checked_at < now() - interval '12 hours')
           order by socials_checked_at asc nulls first, vol_24h desc nulls last limit 30`,
          [Number(chainId), c.minLiq, c.minVol],
        );
        if (!rows.length) continue;
        const addrs = rows.map((r) => r.address);
        const pairs = await ds(`/tokens/v1/${slug}/${addrs.join(",")}`);
        for (const a of addrs) {
          await pool.query("update ext_tokens set has_socials = $3, socials_checked_at = now() where chain_id = $1 and address = $2", [Number(chainId), a, socialsOf(pairs, a)]);
        }
        did += addrs.length;
      } catch (e) {
        log(`socials ${chainId}: ${e.message}`);
      }
      await sleep(1_500);
    }
    if (!did) await sleep(60_000);
  }
}

/** Market price in USD of one whole coin (DexScreener's deepest pair). */
async function marketPrice(chainId, address) {
  const pairs = await ds(`/tokens/v1/${SLUG[chainId]}/${address}`).catch(() => null);
  let best = null;
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (String(p?.baseToken?.address ?? "").toLowerCase() !== address || !(num(p?.priceUsd) > 0)) continue;
    if (!best || (num(p?.liquidity?.usd) ?? 0) > (num(best?.liquidity?.usd) ?? 0)) best = p;
  }
  return best ? num(best.priceUsd) : null;
}

async function kyberOut(chainId, tokenIn, tokenOut, amountIn) {
  const r = await fetch(`${KYBER}/${SLUG[chainId]}/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}&excludeRFQSources=true`, { headers: { "x-client-id": "arkhampad" }, signal: AbortSignal.timeout(15_000) });
  if (r.status === 429) throw Object.assign(new Error("KyberSwap rate limit"), { wait: true });
  const j = await r.json().catch(() => null);
  const out = j?.data?.routeSummary?.amountOut;
  return out ? BigInt(out) : 0n; // no route: 0
}

/** How a $usd buy and sell through KyberSwap compare with the market price (1 = fair). */
export function routeFairness({ usd, price, decimals, usdcDec, coinsOut, usdcOut, coinsSold }) {
  const coins = (v) => Number(v) / 10 ** decimals;
  const buy = (coins(coinsOut) * price) / usd;
  const sell = (Number(usdcOut) / 10 ** usdcDec) / (coins(coinsSold) * price);
  return Math.min(buy, sell);
}

/** Buys and sells $50 of the coin through KyberSwap (quotes only) and compares with the market price. */
export async function routeCheck(net, address, decimals) {
  const price = await marketPrice(net.chainId, address);
  if (!price) return { ok: false, price: null, fair: 0 };
  const usdIn = BigInt(RULES.routeUsd) * 10n ** BigInt(net.usdcDec);
  const coinsOut = await kyberOut(net.chainId, net.usdc, address, usdIn);
  const coinsSold = (BigInt(Math.floor((RULES.routeUsd / price) * 1e6)) * 10n ** BigInt(decimals)) / 1_000_000n; // $50 of the coin
  const usdcOut = coinsSold > 0n ? await kyberOut(net.chainId, address, net.usdc, coinsSold) : 0n;
  const fair = coinsOut > 0n && usdcOut > 0n ? routeFairness({ usd: RULES.routeUsd, price, decimals, usdcDec: net.usdcDec, coinsOut, usdcOut, coinsSold }) : 0;
  return { ok: fair >= RULES.routeFloor, price, fair };
}

/** KyberSwap must buy and sell $50 of the coin within 10% of its market price. Every 3 h. */
async function routeLoop(pool, nets) {
  const ERC = parseAbi(["function decimals() view returns (uint8)"]);
  for (;;) {
    let did = 0;
    const c = config();
    for (const net of nets) {
      if (!SLUG[net.chainId] || !net.rpc) continue;
      const pub = createPublicClient({ transport: http(net.rpc.split(",")[0].trim(), { timeout: 15_000, retryCount: 1 }) });
      // only coins that already pass the cheaper checks
      const { rows } = await pool.query(
        `select address, decimals from ext_tokens
         where chain_id = $1 and ${CANDIDATES} and has_socials is true
           and (route_checked_at is null or route_checked_at < now() - interval '3 hours')
         order by route_checked_at asc nulls first, vol_24h desc nulls last limit 10`,
        [net.chainId, c.minLiq, c.minVol],
      ).catch((e) => { log(`route ${net.chainId}: ${e.message}`); return { rows: [] }; });
      for (const r of rows) {
        try {
          const dec = r.decimals ?? Number(await pub.readContract({ address: r.address, abi: ERC, functionName: "decimals" }));
          const { ok } = await routeCheck(net, r.address, dec);
          await pool.query("update ext_tokens set decimals = $3, route_ok = $4, route_checked_at = now() where chain_id = $1 and address = $2", [net.chainId, r.address, dec, ok]);
          did++;
        } catch (e) {
          log(`route ${net.chainId} ${r.address}: ${e.shortMessage ?? e.message}`);
          if (e.wait) await sleep(60_000);
        }
        await sleep(1_200); // gentle on the free APIs
      }
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

export async function ds(path) {
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
      const { rows } = await pool.query(LIST_SQL, [c.max, c.minLiq, c.minVol, c.activeHours, GOPLUS_CHAINS, c.minAgeHours, RULES.maxTax, RULES.maxTop10, RULES.maxCreator]);
      const r = rows[0];
      log(`${r.listed} coins listed (+${r.added} / -${r.removed})`);
    } catch (e) {
      log(`list: ${e.message}`);
    }
    await sleep(5 * 60_000);
  }
}

/** nets: [{ chainId, rpc, usdc, usdcDec }] for the sell-route check. */
export function startQuality(pool, nets = []) {
  if (process.env.QUALITY_OFF === "1") return log("off (QUALITY_OFF=1)");
  safetyLoop(pool);
  socialsLoop(pool);
  routeLoop(pool, nets);
  attentionLoop(pool);
  listLoop(pool);
}
