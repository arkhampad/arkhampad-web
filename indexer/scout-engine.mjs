// Smart-Money Radar engine — framework-free, pure functions (no DOM, no network).
// Ported 1:1 from the production radar scoring so the output matches it exactly.
// Shared by the browser (app.js) and the Cloudflare Pages Function (functions/api/radar.js).
//
// Reads the recent cross-coin trade flow and collapses each coin to one signal
// (none / building / strong) plus a few capped smart/whale events:
//  - "smart wallets" are inferred from the flow itself: a wallet that bought coins
//    that are running now, while still in profit, has a track record (no external labels).
//  - a "notable" buy is sized AGAINST the coin (share of its market cap), not a flat $ amount.
//  - a "cluster" is 2+ smart/notable buys into one coin inside a short window.

export const WINDOW_MS = 60 * 60_000;     // only trades from the last hour feed a signal
export const RECENT_MS = 10 * 60_000;     // the "N bought in the last 10 min" window
export const CLUSTER_MS = 10 * 60_000;    // smart/notable buys this close together form a cluster
export const DUST_USD = 25;               // ignore buys below this (bot spam / dust) when HYPE price known
export const DUST_HYPE = 0.05;            // same idea before the HYPE price has loaded
export const NOTABLE_MC_PCT = 0.015;      // a buy >= 1.5% of the coin's market cap is "notable"
export const RUNNER_PCT = 50;             // a coin up this much over 24h counts as a "runner"
export const RUNNER_MIN_MC_USD = 3_000;   // a runner must have a real market cap (kills fake pumps)
export const SMART_MIN_RUNNERS = 2;       // a wallet is "smart" once it has caught this many runners
export const MAX_EVENTS = 6;              // never flood a card: at most this many events per coin

const lc = (a) => (a ? String(a).toLowerCase() : "");
const isRunner = (t, usd) =>
  !!t && (t.change24 ?? 0) >= RUNNER_PCT && (t.mcap_hype ?? 0) * (usd || 0) >= RUNNER_MIN_MC_USD;

/** A new coin indexed seconds ago has a price but no stats row yet — derive its market cap from
 *  price * supply so it never scores as "$0". Mirrors the production withImg() fix. */
export function normalizeToken(t) {
  if (!t.mcap_hype && t.price_hype && t.supply) {
    const mc = t.price_hype * (Number(t.supply) / 10 ** (t.decimals ?? 18));
    if (isFinite(mc)) return { ...t, mcap_hype: mc };
  }
  return t;
}

/** A wallet's track record from the recent window only. */
export function computeWallets(trades, byAddr, usd, now) {
  const spend = new Map();
  for (const x of trades) {
    if (x.side !== "buy" || !x.trader) continue;
    if (now - Date.parse(x.at) > WINDOW_MS) continue;
    const w = lc(x.trader), coin = lc(x.token);
    let m = spend.get(w);
    if (!m) spend.set(w, (m = new Map()));
    const e = m.get(coin) ?? { hype: 0, amount: 0 };
    e.hype += x.hype || 0;
    e.amount += x.amount || 0;
    m.set(coin, e);
  }
  const out = new Map();
  for (const [w, coins] of spend) {
    let runners = 0;
    for (const [coin, e] of coins) {
      const t = byAddr.get(coin);
      if (!isRunner(t, usd) || e.amount <= 0) continue;
      const avgPrice = e.hype / e.amount;
      if (t.price_hype && avgPrice > 0 && t.price_hype > avgPrice) runners++;
    }
    out.set(w, { smart: runners >= SMART_MIN_RUNNERS, runners, coins: coins.size });
  }
  return out;
}

/** Score one coin from its own recent buys and the shared smart-wallet records. */
export function scoutCoin(token, coinTrades, records, usd, now) {
  const mcapHype = token.mcap_hype ?? 0;
  const notableHype = NOTABLE_MC_PCT * mcapHype;
  const dustOk = (hype) => (usd > 0 ? hype * usd >= DUST_USD : hype >= DUST_HYPE);

  const agg = new Map();
  for (const x of coinTrades) {
    if (x.side !== "buy" || !x.trader) continue;
    const ts = Date.parse(x.at);
    if (now - ts > WINDOW_MS) continue;
    const w = lc(x.trader);
    const rec = records.get(w);
    let e = agg.get(w);
    if (!e) {
      e = { wallet: w, hype: 0, usd: 0, firstTs: x.at, lastTs: x.at, buys: 0, smart: !!(rec && rec.smart), notable: false, runners: (rec && rec.runners) ?? 0, coins: (rec && rec.coins) ?? 0 };
      agg.set(w, e);
    }
    e.hype += x.hype || 0;
    e.buys += 1;
    if (ts < Date.parse(e.firstTs)) e.firstTs = x.at;
    if (ts > Date.parse(e.lastTs)) e.lastTs = x.at;
  }

  const events = [];
  for (const e of agg.values()) {
    if (!dustOk(e.hype)) continue;
    e.usd = e.hype * (usd || 0);
    e.notable = notableHype > 0 && e.hype >= notableHype;
    events.push(e);
  }

  const smartCount = events.filter((e) => e.smart).length;
  const notableCount = events.filter((e) => e.notable).length;
  const recentCount = events.filter((e) => now - Date.parse(e.lastTs) <= RECENT_MS).length;

  const hot = events.filter((e) => e.smart || e.notable).map((e) => Date.parse(e.firstTs)).sort((a, b) => a - b);
  let clusterSize = 0;
  for (let i = 0; i < hot.length; i++) {
    let n = 0;
    for (let j = i; j < hot.length && hot[j] - hot[i] <= CLUSTER_MS; j++) n++;
    if (n > clusterSize) clusterSize = n;
  }
  const cluster = clusterSize >= 2;

  let signal = "none";
  if (smartCount >= 3 || (cluster && notableCount >= 1) || (smartCount >= 2 && notableCount >= 1)) signal = "strong";
  else if (smartCount >= 1 || notableCount >= 1 || cluster) signal = "building";

  const recency = events.reduce((m, e) => Math.max(m, Date.parse(e.lastTs)), 0);
  const freshBonus = recency ? Math.max(0, 1 - (now - recency) / WINDOW_MS) : 0;
  const score = smartCount * 4 + notableCount * 2.5 + clusterSize * 1.5 + Math.min(recentCount, 10) * 0.5 + freshBonus;

  const shown = events
    .sort((a, b) => Number(b.smart) - Number(a.smart) || Number(b.notable) - Number(a.notable) || b.hype - a.hype)
    .slice(0, MAX_EVENTS);

  return { address: lc(token.address), token, signal, score, smartCount, recentCount, notableCount, cluster, clusterSize, events: shown };
}

const rank = (c) => (c.signal === "strong" ? 2 : c.signal === "building" ? 1 : 0);

/** Build the whole radar from the tokens list and the recent cross-coin trade flow. */
export function buildRadar(tokens, trades, usd, now = Date.now()) {
  const byAddr = new Map(tokens.map((t) => [lc(t.address), t]));
  const smart = computeWallets(trades, byAddr, usd, now);

  const byCoinTrades = new Map();
  for (const x of trades) {
    const coin = lc(x.token);
    let arr = byCoinTrades.get(coin);
    if (!arr) byCoinTrades.set(coin, (arr = []));
    arr.push(x);
  }

  const scored = new Map();
  for (const [coin, list] of byCoinTrades) {
    const token = byAddr.get(coin);
    if (!token) continue;
    const sc = scoutCoin(token, list, smart, usd, now);
    if (sc.signal !== "none") scored.set(coin, sc);
  }
  const top = [...scored.values()].sort((a, b) => rank(b) - rank(a) || b.score - a.score);
  return { smart, top, hasStrong: top.some((c) => c.signal === "strong"), at: now };
}

/** A short, honest track-record tag for one wallet, or null when there's nothing to say. */
export function trackTag(e) {
  if (e.runners >= 1) return `early on ${e.runners} of ${e.coins} recent runners`;
  if (e.notable) return "big buy vs market cap";
  if (e.smart) return "smart wallet";
  return null;
}

export const signalLabel = (s) => (s === "strong" ? "Strong signal" : s === "building" ? "Building" : "No signal");

/** Top-of-page tiles from the whole tracked token set (not just signalled coins). */
function computeTiles(tokens, usd) {
  if (!tokens.length) return { count: 0, mover: null, vol: null, newest: null };
  const withCh = tokens.filter((t) => t.change24 != null && (t.mcap_hype ?? 0) * (usd || 0) >= 500);
  const mover = (withCh.length ? withCh : tokens).slice().sort((a, b) => (b.change24 ?? -1e9) - (a.change24 ?? -1e9))[0];
  const vol = tokens.slice().sort((a, b) => (b.vol24_hype || 0) - (a.vol24_hype || 0))[0];
  const withAge = tokens.filter((t) => t.created_at);
  const newest = withAge.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  return {
    count: tokens.length,
    mover: mover ? { symbol: mover.symbol, change24: mover.change24 ?? null } : null,
    vol: vol ? { symbol: vol.symbol, volUsd: (vol.vol24_hype || 0) * (usd || 0) || null } : null,
    newest: newest ? { symbol: newest.symbol, created_at: newest.created_at } : null,
  };
}

/** Serialise the radar into the compact, JSON-safe shape the UI renders. */
function viewCoins(radar, usd) {
  return radar.top.slice(0, 14).map((c) => ({
    address: c.address,
    name: c.token.name,
    symbol: c.token.symbol,
    mcUsd: (c.token.mcap_hype ?? 0) * (usd || 0) || null,
    change24: c.token.change24 ?? null,
    signal: c.signal,
    score: c.score,
    smartCount: c.smartCount,
    notableCount: c.notableCount,
    recentCount: c.recentCount,
    cluster: c.cluster,
    clusterSize: c.clusterSize,
    events: c.events.map((e) => ({
      wallet: e.wallet, usd: e.usd, hype: e.hype, buys: e.buys,
      smart: e.smart, notable: e.notable, runners: e.runners, coins: e.coins,
      lastTs: e.lastTs, tag: trackTag(e),
    })),
  }));
}

/** The one entry point both the browser and the Pages Function call with raw rows. */
export function buildResponse(tokens, trades, usd, now = Date.now()) {
  const toks = (tokens || []).map(normalizeToken);
  const radar = buildRadar(toks, trades || [], usd || 0, now);
  return {
    at: now,
    usd: usd || 0,
    hasStrong: radar.hasStrong,
    tiles: computeTiles(toks, usd || 0),
    coins: viewCoins(radar, usd || 0),
  };
}

/** The Supabase REST query strings, shared so the client fallback and the Function stay in sync. */
export const QUERIES = {
  tokens: "ely_tokens?select=address,name,symbol,decimals,supply,price_hype,mcap_hype,vol24_hype,change24,created_at&price_hype=not.is.null&order=vol24_hype.desc&limit=2000",
  trades: "ely_trades?select=id,token,tx,log_index,at,side,hype,amount,price_hype,trader&order=at.desc,id.desc&limit=500",
  meta: "ely_meta?select=v&k=eq.hype_usd&limit=1",
};
