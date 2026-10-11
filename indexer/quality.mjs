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

import { createPublicClient, http, parseAbi, encodeAbiParameters, keccak256, getAddress } from "viem";
import { clankerConfigFor, WETH_ADDRESSES } from "clanker-sdk";
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
  minLiq: Number(process.env.QUALITY_MIN_LIQ ?? 5000),
  minVol: Number(process.env.QUALITY_MIN_VOL ?? 5000),
  activeHours: Number(process.env.QUALITY_ACTIVE_HOURS ?? 24),
  // no minimum age: new coins are listed as soon as they pass the safety and sell checks
  minAgeHours: Number(process.env.QUALITY_MIN_AGE_HOURS ?? 0),
});
// what keeps a buyer's money safe stays strict: no honeypot, can be sold, taxes under 5%, no owner powers
// (mint, pause, blacklist...), and a real sale back near the market price. Holder spread and socials
// are no longer required (new coins rarely pass them yet).
export const RULES = { maxTax: 0.05, routeFloor: 0.9, routeUsd: 50 };

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

/** GeckoTerminal token info -> does it show an X account or a website? (free; used when DexScreener has none) */
export function socialsFromGecko(info) {
  const at = info?.data?.attributes ?? {};
  const web = (Array.isArray(at.websites) ? at.websites : []).some((u) => /^https?:\/\//i.test(String(u ?? "")));
  const x = typeof at.twitter_handle === "string" && at.twitter_handle.trim().length > 0;
  return web || x;
}

// ---- coins launched through Clanker anywhere (not only on ArkhamPad): their coin/WETH pool can be
// traded through ArkhamPad's own route. A Clanker v4 pool's key is coin/WETH, the dynamic-fee flag,
// spacing 200 and one of Clanker's fee hooks, so the pool id tells which hook it uses.
const KEY = [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }];
export function clankerHooks(chainId) {
  const r = clankerConfigFor(Number(chainId), "clanker_v4")?.related ?? {};
  return [...new Set([r.feeStaticHook, r.feeStaticHookV2, r.feeDynamicHook, r.feeDynamicHookV2].filter((h) => h && BigInt(h) !== 0n).map((h) => getAddress(h)))];
}
/** The Clanker hook of `coin`'s pool when `poolId` is a Clanker coin/WETH v4 pool, else null. */
export function clankerHookOf(chainId, coin, poolId) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(poolId ?? ""))) return null;
  const weth = WETH_ADDRESSES[Number(chainId)];
  if (!weth) return null;
  const c = getAddress(coin), w = getAddress(weth);
  const [c0, c1] = BigInt(c) < BigInt(w) ? [c, w] : [w, c];
  for (const hook of clankerHooks(chainId)) {
    if (keccak256(encodeAbiParameters(KEY, [c0, c1, 0x800000, 200, hook])).toLowerCase() === String(poolId).toLowerCase()) return hook;
  }
  return null;
}

/** The listing rule as one SQL statement (exported for tests).
 *  $1 max, $2 minLiq, $3 minVol, $4 activeHours, $5 goplus chain ids, $6 minAgeHours, $7 maxTax */
export const LIST_SQL = `
with ok as (
  select chain_id, address from ext_tokens
  where coalesce(liq_usd, 0) >= $2
    and coalesce(vol_24h, 0) >= $3
    and updated_at > now() - make_interval(hours => $4::int)
    and coalesce(pool_created, first_seen) < now() - make_interval(hours => $6::int)
    and route_ok is true and route_checked_at > now() - interval '12 hours'
    and (
      (chain_id = any($5::int[])
        and gp_checked_at is not null
        and honeypot is false
        and coalesce(cannot_sell, false) = false
        and sell_tax is not null and sell_tax < $7
        and buy_tax is not null and buy_tax < $7
        and owner_risk is false)
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
  update ext_tokens t set listed = true, listed_at = coalesce(t.listed_at, now()),
    first_mc = coalesce(t.first_mc, t.mcap_usd, t.fdv_usd)
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
           order by gp_checked_at asc nulls first, vol_24h desc nulls last limit 10`,
          [chainId, c.minLiq, c.minVol],
        );
        for (const { address: a } of rows) {
          // one coin per call: GoPlus's free tier answers only the first coin of a batch
          const res = await goplus(chainId, [a]);
          const g = res[a] ?? res[a.toLowerCase()];
          if (!g || typeof g !== "object" || !Object.keys(g).length) {
            // no answer (yet): ask again in about an hour, the coin stays unlisted meanwhile
            await pool.query(
              `update ext_tokens set gp_checked_at = now() - interval '23 hours' where chain_id = $1 and address = $2`,
              [chainId, a],
            );
          } else {
            const s = safetyOf(g);
            await pool.query(
              `update ext_tokens set gp_checked_at = now(), honeypot = $3, cannot_sell = $4, buy_tax = $5, sell_tax = $6,
                 owner_risk = $7, top10_pct = $8, creator_pct = $9
               where chain_id = $1 and address = $2`,
              [chainId, a, s.honeypot, s.cannot_sell, s.buy_tax, s.sell_tax, s.owner_risk, s.top10_pct, s.creator_pct],
            );
          }
          did++;
          await sleep(2_500); // GoPlus free tier: about 30 calls a minute
        }
      } catch (e) {
        log(`safety ${chainId}: ${e.message}`);
        if (e.wait) await sleep(60_000);
      }
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
          let has = socialsOf(pairs, a);
          if (!has) {
            // GeckoTerminal's free token info often has the links DexScreener only shows for paid profiles
            const net = (await pool.query("select network from ext_tokens where chain_id = $1 and address = $2", [Number(chainId), a])).rows[0]?.network;
            if (net) {
              const g = await fetch(`https://api.geckoterminal.com/api/v2/networks/${net}/tokens/${a}/info`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
              has = socialsFromGecko(g);
              await sleep(2_100); // GeckoTerminal free tier: 30 calls a minute
            }
          }
          await pool.query("update ext_tokens set has_socials = $3, socials_checked_at = now() where chain_id = $1 and address = $2", [Number(chainId), a, has]);
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
  const a = String(address).toLowerCase(); // checksummed or not
  const pairs = await ds(`/tokens/v1/${SLUG[chainId]}/${a}`).catch(() => null);
  let best = null;
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (String(p?.baseToken?.address ?? "").toLowerCase() !== a || !(num(p?.priceUsd) > 0)) continue;
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

const ROUTE_ABI = [{ type: "function", name: "quoteRoundTrip", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }, { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] }], outputs: [{ type: "uint256" }, { type: "uint256" }] }];
/** Through ArkhamPad's own route: $50 must buy near the market price and sell straight back for 90%+. */
export async function clankerRouteCheck(net, pub, address, decimals, poolId, hook) {
  const price = await marketPrice(net.chainId, address);
  if (!price) return { ok: false, price: null, fair: 0 };
  const weth = getAddress(WETH_ADDRESSES[Number(net.chainId)]), c = getAddress(address);
  const [c0, c1] = BigInt(c) < BigInt(weth) ? [c, weth] : [weth, c];
  const key = { currency0: c0, currency1: c1, fee: 0x800000, tickSpacing: 200, hooks: getAddress(hook) };
  const usdIn = BigInt(RULES.routeUsd) * 10n ** BigInt(net.usdcDec);
  let err = null;
  const sim = await pub.simulateContract({ address: getAddress(net.route), abi: ROUTE_ABI, functionName: "quoteRoundTrip", args: [c, usdIn, key] }).catch((e) => { err = e.shortMessage ?? e.message; return null; });
  if (!sim) return { ok: false, price, fair: 0, err };
  const [coins, back] = sim.result;
  const buy = ((Number(coins) / 10 ** decimals) * price) / RULES.routeUsd;
  const sell = Number(back) / Number(usdIn);
  const fair = Math.min(buy, sell);
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
        `select address, decimals, pool from ext_tokens
         where chain_id = $1 and ${CANDIDATES}
           and (route_checked_at is null or route_checked_at < now() - interval '3 hours')
         order by route_checked_at asc nulls first, vol_24h desc nulls last limit 10`,
        [net.chainId, c.minLiq, c.minVol],
      ).catch((e) => { log(`route ${net.chainId}: ${e.message}`); return { rows: [] }; });
      for (const r of rows) {
        try {
          const dec = r.decimals ?? Number(await pub.readContract({ address: r.address, abi: ERC, functionName: "decimals" }));
          // a Clanker coin (launched anywhere) trades through ArkhamPad's own route; others through KyberSwap
          const hook = net.route ? clankerHookOf(net.chainId, r.address, r.pool) : null;
          const { ok } = hook ? await clankerRouteCheck(net, pub, r.address, dec, r.pool, hook) : await routeCheck(net, r.address, dec);
          // the pool id is saved with its hook: the site trades the pool that was checked, even if the
          // coin's main pool on DexScreener changes later
          await pool.query("update ext_tokens set decimals = $3, route_ok = $4, route_checked_at = now(), clanker_hook = $5, clanker_pool = $6 where chain_id = $1 and address = $2", [net.chainId, r.address, dec, ok, hook ? hook.toLowerCase() : null, hook ? String(r.pool).toLowerCase() : null]);
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

/** Trending order for listed coins: healthy momentum first, not coins that already pumped.
 *  More buys than sells, volume speeding up, busy right now, rising but not parabolic, young,
 *  deep enough to trade. Unlisted coins get no score. Percent columns are in percent (12.5 = +12.5%). */
export const SCORE_SQL = `
with s as (
  update ext_tokens set score = round((
      4 * (coalesce(buys_24h, 0)::numeric / greatest(coalesce(buys_24h, 0) + coalesce(sells_24h, 0), 1) - 0.5)
    + least(coalesce(vol_1h, 0)::numeric * 24 / greatest(coalesce(vol_24h, 0)::numeric, 1), 3)
    + least(coalesce(txns_5m, 0), 50)::numeric / 25
    + case when change_1h between 2 and 60 then 1.5 when change_1h > 150 then -2 when change_1h < -20 then -1.5 else 0 end
    + case when change_24h > 400 then -2 when change_24h > 200 then -1 else 0 end
    + case when pool_created > now() - interval '3 days' then 1 else 0 end
    + least(greatest(log(greatest(coalesce(liq_usd, 1), 1)::numeric) - 4, 0), 2) * 0.5
  )::numeric, 3)
  where listed
  returning 1
),
c as (update ext_tokens set score = null where not listed and score is not null returning 1)
select (select count(*) from s)::int as scored`;

/** ArkhamPad Picks: at most 10 open picks (picked in the last 24 h), only coins with the strongest
 *  healthy momentum. A coin is picked again only a day after its last pick. Strict on purpose:
 *  when nothing qualifies, nothing is picked. */
export const PICK_RULES = { maxOpen: 10, perRound: 2, minScore: 5, minLiq: 20000, minVol: 30000, minBuyShare: 0.55, minTxns5m: 5 };
export const PICKS_SQL = `
with open as (select count(*)::int n from ext_picks where picked_at > now() - interval '24 hours'),
cand as (
  select t.chain_id, t.address, t.name, t.symbol, t.image, coalesce(t.mcap_usd, t.fdv_usd) as mc, t.score
  from ext_tokens t
  where t.listed and t.score >= $1
    and coalesce(t.liq_usd, 0) >= $2 and coalesce(t.vol_24h, 0) >= $3
    and coalesce(t.buys_24h, 0)::numeric / greatest(coalesce(t.buys_24h, 0) + coalesce(t.sells_24h, 0), 1) >= $4
    and coalesce(t.txns_5m, 0) >= $5
    and t.change_1h between 2 and 60 and coalesce(t.change_24h, 0) <= 200
    and coalesce(t.mcap_usd, t.fdv_usd) > 0
    and t.updated_at > now() - interval '15 minutes'
    and not exists (select 1 from ext_picks p where p.chain_id = t.chain_id and p.address = t.address and p.picked_at > now() - interval '24 hours')
  order by t.score desc
  limit greatest(least($6::int, $7::int - (select n from open)), 0)
)
insert into ext_picks (chain_id, address, name, symbol, image, pick_mc, score)
select chain_id, address, name, symbol, image, mc, score from cand
returning id`;
/** Each pick's real market cap 1 hour and 24 hours later (from the same refreshed market data). */
export const RESOLVE_SQL = `
update ext_picks p set
  -- the 1-hour result only while it is still about an hour later (a missed one stays empty, never late)
  mc_1h = case when p.mc_1h is null and p.picked_at <= now() - interval '1 hour' and p.picked_at > now() - interval '2 hours'
               then coalesce(t.mcap_usd, t.fdv_usd) else p.mc_1h end,
  mc_24h = case when p.mc_24h is null and p.picked_at <= now() - interval '24 hours'
                then coalesce(t.mcap_usd, t.fdv_usd) else p.mc_24h end
from ext_tokens t
where t.chain_id = p.chain_id and t.address = p.address
  and ((p.mc_1h is null and p.picked_at <= now() - interval '1 hour' and p.picked_at > now() - interval '2 hours')
    or (p.mc_24h is null and p.picked_at <= now() - interval '24 hours'))
returning p.id`;

async function picksLoop(pool) {
  for (;;) {
    try {
      const r = PICK_RULES;
      const made = await pool.query(PICKS_SQL, [r.minScore, r.minLiq, r.minVol, r.minBuyShare, r.minTxns5m, r.perRound, r.maxOpen]);
      const done = await pool.query(RESOLVE_SQL);
      if (made.rowCount || done.rowCount) log(`picks: +${made.rowCount} picked, ${done.rowCount} results saved`);
    } catch (e) {
      log(`picks: ${e.message}`);
    }
    await sleep(5 * 60_000);
  }
}

async function listLoop(pool) {
  for (;;) {
    try {
      const c = config();
      const { rows } = await pool.query(LIST_SQL, [c.max, c.minLiq, c.minVol, c.activeHours, GOPLUS_CHAINS, c.minAgeHours, RULES.maxTax]);
      const r = rows[0];
      log(`${r.listed} coins listed (+${r.added} / -${r.removed})`);
      await pool.query(SCORE_SQL).catch((e) => log(`score: ${e.message}`));
    } catch (e) {
      log(`list: ${e.message}`);
    }
    await sleep(60_000); // every minute, so new coins show up soon after their checks
  }
}

/** nets: [{ chainId, rpc, usdc, usdcDec, route }] for the sell-route check (route: PadClankerRoute). */
export function startQuality(pool, nets = []) {
  if (process.env.QUALITY_OFF === "1") return log("off (QUALITY_OFF=1)");
  safetyLoop(pool);
  socialsLoop(pool);
  routeLoop(pool, nets);
  attentionLoop(pool);
  listLoop(pool);
  picksLoop(pool);
}
