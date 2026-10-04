// Coins from other DEXs, shown on ArkhamPad for discovery (display only, no trading yet).
//
// Discovery (GeckoTerminal, slow and steady): walks the busiest pools of every DEX
// on each network, plus trending and new pools, and stores each token once.
// Refresh (DexScreener, fast): updates price, volume, liquidity and changes for
// every stored token in batches of 30, and keeps a small price history for sparklines.
//
// Env: MARKETS ("0" turns it off), MARKETS_GAP_MS (GeckoTerminal pause, default 6500).
const GT = process.env.GT_URL || "https://api.geckoterminal.com/api/v2";
const DS = process.env.DS_URL || "https://api.dexscreener.com";
const GAP = Number(process.env.MARKETS_GAP_MS ?? 6500);
const REFRESH_EVERY_MS = Number(process.env.MARKETS_REFRESH_MS ?? 120_000);
const SPARK_POINTS = 48;
const MIN_LIQ_USD = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), "markets:", ...a);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const int = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };
const MAX_USD = 1e12;
const sane = (v) => { const n = num(v); return n !== null && n > 0 && n < MAX_USD ? n : null; };

// Plumbing tokens (gas coins, stablecoins, staked ETH, majors) are not what people come for.
const SKIP = new Set(["WETH", "ETH", "USDC", "USDT", "DAI", "USDE", "USDS", "USDG", "WBTC", "CBBTC", "TBTC", "CBETH", "WSTETH", "STETH", "RETH", "EURC", "USD1", "PYUSD", "FRAX", "LUSD", "GHO", "USDBC", "XAUT", "PAXG", "EZETH", "WEETH", "SUPEROETHB", "MSETH"]);
export function plumbing(symbol, name) {
  const s = String(symbol ?? "").toUpperCase();
  const n = String(name ?? "");
  return SKIP.has(s) || /USD/.test(s) || /^W[A-Z]{2,5}$/.test(s) && /wrapped/i.test(n) || /\bwrapped\b/i.test(n) || /\bstable ?coin\b/i.test(n) || /^(ST|WST|WE|EZ|R|CB|OS|MS)ETH$/.test(s);
}

export const NETWORKS = [
  { id: "base", chainId: 8453, ds: "base" },
  // Robinhood Chain is looked up by name at start (see findNetworks).
];

let lastGt = 0;
async function gt(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastGt + GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastGt = Date.now();
    const r = await fetch(`${GT}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) }).catch((e) => ({ ok: false, status: 0, e }));
    if (r.status === 429) { await sleep(60_000); continue; }
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    await sleep(5_000);
  }
  throw new Error(`GeckoTerminal failed: ${path}`);
}

async function ds(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${DS}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) }).catch(() => ({ ok: false, status: 0 }));
    if (r.status === 429) { await sleep(30_000); continue; }
    if (r.ok) return r.json();
    await sleep(3_000);
  }
  throw new Error(`DexScreener failed: ${path}`);
}

/** GeckoTerminal pools response (with include=base_token) -> token rows. */
export function rowsFromPools(json, net, rankFrom = null) {
  const tokens = new Map();
  for (const t of json?.included ?? []) if (t?.type === "token") tokens.set(t.id, t.attributes ?? {});
  const out = [];
  (json?.data ?? []).forEach((p, i) => {
    const a = p?.attributes ?? {};
    const id = p?.relationships?.base_token?.data?.id;
    if (typeof id !== "string") return;
    const address = id.slice(id.indexOf("_") + 1).toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) return;
    const t = tokens.get(id) ?? {};
    const symbol = String(t.symbol ?? String(a.name ?? "").split(" / ")[0] ?? "").trim();
    if (!symbol || plumbing(symbol, t.name)) return;
    const liq = num(a.reserve_in_usd);
    if (liq === null || liq < MIN_LIQ_USD) return;
    if ((num(a.fdv_usd) ?? 0) > MAX_USD) return;
    const tx = a.transactions?.h24 ?? {};
    out.push({
      chain_id: net.chainId, address, network: net.id,
      pool: String(a.address ?? "").toLowerCase() || null,
      dex: p?.relationships?.dex?.data?.id ?? null,
      name: String(t.name ?? symbol).slice(0, 80), symbol: symbol.slice(0, 24),
      image: typeof t.image_url === "string" && t.image_url.startsWith("https://") ? t.image_url : null,
      price_usd: num(a.base_token_price_usd), mcap_usd: sane(a.market_cap_usd), fdv_usd: sane(a.fdv_usd),
      liq_usd: liq, vol_24h: num(a.volume_usd?.h24),
      change_1h: num(a.price_change_percentage?.h1), change_24h: num(a.price_change_percentage?.h24),
      buys_24h: int(tx.buys), sells_24h: int(tx.sells),
      pool_created: a.pool_created_at && !isNaN(Date.parse(a.pool_created_at)) ? new Date(a.pool_created_at).toISOString() : null,
      trending_rank: rankFrom === null ? null : rankFrom + i + 1,
    });
  });
  // a token can appear in several pools: keep the deepest
  const best = new Map();
  const minRank = (x, y) => (x === null ? y : y === null ? x : Math.min(x, y));
  for (const r of out) {
    const c = best.get(r.address);
    const rank = minRank(r.trending_rank, c?.trending_rank ?? null);
    if (!c || (r.liq_usd ?? 0) > (c.liq_usd ?? 0)) best.set(r.address, { ...r, trending_rank: rank });
    else c.trending_rank = rank;
  }
  return [...best.values()];
}

/** DexScreener /tokens/v1 pairs -> one update per token (its deepest pair). */
export function updatesFromPairs(pairs) {
  const best = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const address = String(p?.baseToken?.address ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) continue;
    const liq = num(p?.liquidity?.usd) ?? 0;
    const cur = best.get(address);
    if (cur && cur.liq_usd >= liq) continue;
    best.set(address, {
      address,
      price_usd: num(p?.priceUsd), liq_usd: liq, vol_24h: num(p?.volume?.h24),
      change_1h: num(p?.priceChange?.h1), change_24h: num(p?.priceChange?.h24),
      mcap_usd: sane(p?.marketCap), fdv_usd: sane(p?.fdv),
      buys_24h: int(p?.txns?.h24?.buys), sells_24h: int(p?.txns?.h24?.sells),
      image: typeof p?.info?.imageUrl === "string" && p.info.imageUrl.startsWith("https://") ? p.info.imageUrl : null,
    });
  }
  return [...best.values()];
}

const COLS = ["chain_id", "address", "network", "pool", "dex", "name", "symbol", "image", "price_usd", "mcap_usd", "fdv_usd", "liq_usd", "vol_24h", "change_1h", "change_24h", "buys_24h", "sells_24h", "pool_created", "trending_rank"];

export async function upsertTokens(pool, rows) {
  if (!rows.length) return 0;
  const vals = [], params = [];
  rows.forEach((r, i) => {
    vals.push(`(${COLS.map((_, j) => `$${i * COLS.length + j + 1}`).join(",")})`);
    for (const c of COLS) params.push(r[c] ?? null);
  });
  const res = await pool.query(
    `insert into ext_tokens (${COLS.join(",")}) values ${vals.join(",")}
     on conflict (chain_id, address) do update set
       pool = coalesce(excluded.pool, ext_tokens.pool), dex = coalesce(excluded.dex, ext_tokens.dex),
       name = excluded.name, symbol = excluded.symbol, image = coalesce(excluded.image, ext_tokens.image),
       price_usd = coalesce(excluded.price_usd, ext_tokens.price_usd), mcap_usd = coalesce(excluded.mcap_usd, ext_tokens.mcap_usd),
       fdv_usd = coalesce(excluded.fdv_usd, ext_tokens.fdv_usd), liq_usd = coalesce(excluded.liq_usd, ext_tokens.liq_usd),
       vol_24h = coalesce(excluded.vol_24h, ext_tokens.vol_24h), change_1h = coalesce(excluded.change_1h, ext_tokens.change_1h),
       change_24h = coalesce(excluded.change_24h, ext_tokens.change_24h), buys_24h = coalesce(excluded.buys_24h, ext_tokens.buys_24h),
       sells_24h = coalesce(excluded.sells_24h, ext_tokens.sells_24h), pool_created = coalesce(ext_tokens.pool_created, excluded.pool_created),
       trending_rank = coalesce(excluded.trending_rank, ext_tokens.trending_rank), updated_at = now()`,
    params,
  );
  return res.rowCount;
}

export async function applyUpdates(pool, chainId, ups) {
  for (const u of ups) {
    await pool.query(
      `update ext_tokens set
         price_usd = coalesce($3, price_usd), liq_usd = $4, vol_24h = coalesce($5, vol_24h),
         change_1h = coalesce($6, change_1h), change_24h = coalesce($7, change_24h),
         mcap_usd = coalesce($8, mcap_usd), fdv_usd = coalesce($9, fdv_usd),
         buys_24h = coalesce($10, buys_24h), sells_24h = coalesce($11, sells_24h),
         image = coalesce(image, $12),
         spark = case when $3::numeric is null then spark else (spark || $3::numeric)[greatest(1, cardinality(spark) + 2 - ${SPARK_POINTS}):] end,
         updated_at = now()
       where chain_id = $1 and address = $2`,
      [chainId, u.address, u.price_usd, u.liq_usd, u.vol_24h, u.change_1h, u.change_24h, u.mcap_usd, u.fdv_usd, u.buys_24h, u.sells_24h, u.image],
    );
  }
}

async function findNetworks() {
  const nets = [...NETWORKS];
  for (let page = 1; page <= 10; page++) {
    const j = await gt(`/networks?page=${page}`).catch(() => null);
    const list = j?.data ?? [];
    for (const n of list) {
      const name = `${n?.id ?? ""} ${n?.attributes?.name ?? ""}`;
      if (/robinhood/i.test(name) && !/test/i.test(name) && !nets.some((x) => x.chainId === 4663)) nets.push({ id: n.id, chainId: 4663, ds: null });
    }
    if (list.length < 100) break;
  }
  return nets;
}

async function dexesOf(net) {
  const ids = [];
  for (let page = 1; page <= 3; page++) {
    const j = await gt(`/networks/${net.id}/dexes?page=${page}`).catch(() => null);
    const list = j?.data ?? [];
    ids.push(...list.map((d) => d.id).filter(Boolean));
    if (list.length < 100) break;
  }
  return ids;
}

async function discoverLoop(pool) {
  const nets = await findNetworks();
  log(`networks: ${nets.map((n) => n.id).join(", ")}`);
  for (;;) {
    for (const net of nets) {
      // trending and new first, they matter most for the front page
      await pool.query("update ext_tokens set trending_rank = null where chain_id = $1", [net.chainId]);
      for (let page = 1; page <= 5; page++) {
        const j = await gt(`/networks/${net.id}/trending_pools?include=base_token&page=${page}`).catch(() => null);
        await upsertTokens(pool, rowsFromPools(j, net, (page - 1) * 20));
      }
      for (let page = 1; page <= 5; page++) {
        const j = await gt(`/networks/${net.id}/new_pools?include=base_token&page=${page}`).catch(() => null);
        await upsertTokens(pool, rowsFromPools(j, net));
      }
      const dexes = await dexesOf(net);
      for (const dex of dexes) {
        for (const sort of ["h24_volume_usd_desc", "h24_tx_count_desc"]) {
          for (let page = 1; page <= 10; page++) {
            const j = await gt(`/networks/${net.id}/dexes/${dex}/pools?include=base_token&sort=${sort}&page=${page}`).catch(() => null);
            const rows = rowsFromPools(j, net);
            await upsertTokens(pool, rows);
            if ((j?.data ?? []).length < 20) break; // last page of this dex
          }
        }
      }
      const { rows } = await pool.query("select count(*)::int n from ext_tokens where chain_id = $1", [net.chainId]);
      log(`${net.id}: ${rows[0].n} coins after a full pass over ${dexes.length} DEXs`);
    }
  }
}

async function refreshLoop(pool) {
  for (;;) {
    const started = Date.now();
    for (const net of NETWORKS.filter((n) => n.ds)) {
      const { rows } = await pool.query("select address from ext_tokens where chain_id = $1 order by vol_24h desc nulls last", [net.chainId]);
      for (let i = 0; i < rows.length; i += 30) {
        const batch = rows.slice(i, i + 30).map((r) => r.address);
        const pairs = await ds(`/tokens/v1/${net.ds}/${batch.join(",")}`).catch(() => null);
        if (pairs) await applyUpdates(pool, net.chainId, updatesFromPairs(pairs));
        await sleep(250); // ~240 calls a minute, under DexScreener's 300
      }
    }
    await sleep(Math.max(5_000, REFRESH_EVERY_MS - (Date.now() - started)));
  }
}

export function startMarkets(pool) {
  if (process.env.MARKETS === "0") return;
  const guard = (name, fn) => (async () => { for (;;) { try { await fn(pool); } catch (e) { log(`${name} error: ${e.message}`); await sleep(30_000); } } })();
  guard("discover", discoverLoop);
  guard("refresh", refreshLoop);
}
