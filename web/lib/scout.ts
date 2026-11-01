"use client";
// Smart Money Radar engine ("Scout"). One glanceable smart-money score per coin, from the trade and
// market data the site already fetches (ely_trades + ely_tokens via lib/ely) — no new paid sources.
//
// How it reads the flow, kept deliberately anti-noise:
//  - "smart wallets" are worked out from the recent cross-coin trade flow itself: a wallet that bought
//    coins that are running now (and is in profit on them) has a track record. No external labels.
//  - a "notable" buy is sized AGAINST the coin (share of its market cap), never a flat dollar amount, so
//    a small buy into a tiny coin counts and the same buy into a huge coin doesn't.
//  - a "cluster" is 2+ smart/notable buys into one coin inside a short window.
//  - every coin collapses to one signal (none / building / strong) and a handful of capped events;
//    repeat buys from the same wallet fold into one, dust and tiny buys are dropped.
import { useEffect, useState } from "react";
import { fetchHypeUsd, fetchLiveTrades, fetchTokens, fetchTrades, usePoll, type EToken, type ETrade } from "./ely";

export type ScoutSignal = "none" | "building" | "strong";

/** One wallet's buy into one coin, after same-wallet repeats are folded together. */
export type ScoutEvent = {
  wallet: string;
  hype: number;
  usd: number;
  firstTs: string;
  lastTs: string;
  buys: number;
  smart: boolean;
  notable: boolean;
  /** recent runners this wallet caught early, and how many coins it bought in the window */
  runners: number;
  coins: number;
};

export type ScoutCoin = {
  address: string;
  token: EToken;
  signal: ScoutSignal;
  score: number;
  /** distinct smart wallets that bought in the window */
  smartCount: number;
  /** distinct wallets (non-dust) that bought in the last 10 minutes */
  recentCount: number;
  notableCount: number;
  cluster: boolean;
  clusterSize: number;
  events: ScoutEvent[];
};

export type WalletRecord = { smart: boolean; runners: number; coins: number };
export type Radar = {
  smart: Map<string, WalletRecord>;
  byAddr: Map<string, ScoutCoin>;
  /** coins with a live signal, best first */
  top: ScoutCoin[];
  hasStrong: boolean;
  at: number;
};

// ---- tuning (documented heuristics, all cheap to compute) --------------------------------------
const WINDOW_MS = 60 * 60_000; // only trades from the last hour feed a signal
const RECENT_MS = 10 * 60_000; // the "N bought in the last 10 min" window
const CLUSTER_MS = 10 * 60_000; // smart/notable buys this close together form a cluster
const DUST_USD = 25; // ignore buys below this (bot spam / dust), when the HYPE price is known
const DUST_HYPE = 0.05; // same idea before the HYPE price has loaded
const NOTABLE_MC_PCT = 0.015; // a buy >= 1.5% of the coin's market cap is "notable" (proportional)
const RUNNER_PCT = 50; // a coin up this much over 24h counts as a "runner"
const RUNNER_MIN_MC_USD = 3_000; // a runner must have a real market cap (kills fake pumps)
const SMART_MIN_RUNNERS = 2; // a wallet is "smart" once it has caught this many recent runners
const MAX_EVENTS = 6; // never flood a card: at most this many events shown per coin

const lc = (a: string | null | undefined) => (a ? a.toLowerCase() : "");
const isRunner = (t: EToken | undefined, usd: number) =>
  !!t && (t.change24 ?? 0) >= RUNNER_PCT && (t.mcap_hype ?? 0) * (usd || 0) >= RUNNER_MIN_MC_USD;

/** A wallet's track record, from the recent window only: coins it bought and how many of those are
 *  running now while it is still in profit (so it got in early). Honest about the small window. */
export function computeWallets(trades: ETrade[], byAddr: Map<string, EToken>, usd: number, now: number): Map<string, WalletRecord> {
  // wallet -> coin -> { hype in, amount in } (buys only, inside the window)
  const spend = new Map<string, Map<string, { hype: number; amount: number }>>();
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
  const out = new Map<string, WalletRecord>();
  for (const [w, coins] of spend) {
    let runners = 0;
    for (const [coin, e] of coins) {
      const t = byAddr.get(coin);
      if (!isRunner(t, usd) || e.amount <= 0) continue;
      // caught early = bought below where the coin trades now
      const avgPrice = e.hype / e.amount; // HYPE per token paid
      if (t!.price_hype && avgPrice > 0 && t!.price_hype > avgPrice) runners++;
    }
    out.set(w, { smart: runners >= SMART_MIN_RUNNERS, runners, coins: coins.size });
  }
  return out;
}

/** Score one coin from its own recent buys and the shared smart-wallet records. Pure and reusable:
 *  the radar calls it with the global window's trades, the coin panel with the coin's own trades. */
export function scoutCoin(token: EToken, coinTrades: ETrade[], records: Map<string, WalletRecord>, usd: number, now: number): ScoutCoin {
  const mcapHype = token.mcap_hype ?? 0;
  const notableHype = NOTABLE_MC_PCT * mcapHype; // buy size (in HYPE) that is notable for THIS coin
  const dustOk = (hype: number) => (usd > 0 ? hype * usd >= DUST_USD : hype >= DUST_HYPE);

  // fold every wallet's repeat buys in the window into one event
  const agg = new Map<string, ScoutEvent>();
  for (const x of coinTrades) {
    if (x.side !== "buy" || !x.trader) continue;
    const ts = Date.parse(x.at);
    if (now - ts > WINDOW_MS) continue;
    const w = lc(x.trader);
    const rec = records.get(w);
    let e = agg.get(w);
    if (!e) {
      e = { wallet: w, hype: 0, usd: 0, firstTs: x.at, lastTs: x.at, buys: 0, smart: !!rec?.smart, notable: false, runners: rec?.runners ?? 0, coins: rec?.coins ?? 0 };
      agg.set(w, e);
    }
    e.hype += x.hype || 0;
    e.buys += 1;
    if (ts < Date.parse(e.firstTs)) e.firstTs = x.at;
    if (ts > Date.parse(e.lastTs)) e.lastTs = x.at;
  }

  const events: ScoutEvent[] = [];
  for (const e of agg.values()) {
    if (!dustOk(e.hype)) continue; // drop dust / likely bots
    e.usd = e.hype * (usd || 0);
    e.notable = notableHype > 0 && e.hype >= notableHype;
    events.push(e);
  }

  const smartCount = events.filter((e) => e.smart).length;
  const notableCount = events.filter((e) => e.notable).length;
  const recentCount = events.filter((e) => now - Date.parse(e.lastTs) <= RECENT_MS).length;

  // cluster = most smart/notable buys landing inside one 10-minute window
  const hot = events.filter((e) => e.smart || e.notable).map((e) => Date.parse(e.firstTs)).sort((a, b) => a - b);
  let clusterSize = 0;
  for (let i = 0; i < hot.length; i++) {
    let n = 0;
    for (let j = i; j < hot.length && hot[j] - hot[i] <= CLUSTER_MS; j++) n++;
    if (n > clusterSize) clusterSize = n;
  }
  const cluster = clusterSize >= 2;

  let signal: ScoutSignal = "none";
  if (smartCount >= 3 || (cluster && notableCount >= 1) || (smartCount >= 2 && notableCount >= 1)) signal = "strong";
  else if (smartCount >= 1 || notableCount >= 1 || cluster) signal = "building";

  const recency = events.reduce((m, e) => Math.max(m, Date.parse(e.lastTs)), 0);
  const freshBonus = recency ? Math.max(0, 1 - (now - recency) / WINDOW_MS) : 0;
  const score = smartCount * 4 + notableCount * 2.5 + clusterSize * 1.5 + Math.min(recentCount, 10) * 0.5 + freshBonus;

  // show the most telling events first (smart, then notable, then biggest), capped so a card never floods
  const shown = events
    .sort((a, b) => Number(b.smart) - Number(a.smart) || Number(b.notable) - Number(a.notable) || b.hype - a.hype)
    .slice(0, MAX_EVENTS);

  return { address: lc(token.address), token, signal, score, smartCount, recentCount, notableCount, cluster, clusterSize, events: shown };
}

/** Build the whole radar from the tokens list and the recent cross-coin trade flow. */
export function buildRadar(tokens: EToken[], trades: ETrade[], usd: number, now = Date.now()): Radar {
  const byAddr = new Map(tokens.map((t) => [lc(t.address), t]));
  const smart = computeWallets(trades, byAddr, usd, now);

  // group the window's trades by coin
  const byCoinTrades = new Map<string, ETrade[]>();
  for (const x of trades) {
    const coin = lc(x.token);
    (byCoinTrades.get(coin) ?? byCoinTrades.set(coin, []).get(coin)!).push(x);
  }

  const scored = new Map<string, ScoutCoin>();
  for (const [coin, list] of byCoinTrades) {
    const token = byAddr.get(coin);
    if (!token) continue; // a coin we don't have market data for yet: can't size it, skip
    const sc = scoutCoin(token, list, smart, usd, now);
    if (sc.signal !== "none") scored.set(coin, sc);
  }
  const top = [...scored.values()].sort((a, b) => rank(b) - rank(a) || b.score - a.score);
  return { smart, byAddr: scored, top, hasStrong: top.some((c) => c.signal === "strong"), at: now };
}

const rank = (c: ScoutCoin) => (c.signal === "strong" ? 2 : c.signal === "building" ? 1 : 0);

/** A short, honest track-record tag for one wallet, or null when there's nothing to say. */
export function trackTag(e: Pick<ScoutEvent, "smart" | "notable" | "runners" | "coins">): string | null {
  if (e.runners >= 1) return `early on ${e.runners} of ${e.coins} recent runners`;
  if (e.notable) return "big buy vs market cap";
  return null;
}

export const signalLabel = (s: ScoutSignal) => (s === "strong" ? "Strong signal" : s === "building" ? "Building" : "No signal");

// ---- shared radar poller -----------------------------------------------------------------------
// One polling loop feeds every consumer (discover badges, the radar page, the toast and the bottom-bar
// robot), so the data is fetched once no matter how many components are mounted.
let radar: Radar | null = null;
let tokensCache: EToken[] = [];
let usdCache = 0;
let lastTokens = 0;
let subs = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(r: Radar) => void>();

async function refresh() {
  try {
    const now = Date.now();
    // tokens and the HYPE price change slowly; refresh them at most once a minute
    if (!tokensCache.length || now - lastTokens > 60_000) {
      const [tk, u] = await Promise.all([fetchTokens().catch(() => tokensCache), fetchHypeUsd().catch(() => usdCache)]);
      tokensCache = tk.length ? tk : tokensCache;
      usdCache = u || usdCache;
      lastTokens = now;
    }
    const trades = await fetchLiveTrades(500);
    radar = buildRadar(tokensCache, trades, usdCache, Date.now());
    listeners.forEach((f) => f(radar!));
  } catch {
    /* keep the last good radar */
  }
}

function loop() {
  if (document.visibilityState === "visible") refresh();
  timer = setTimeout(loop, 12_000);
}

/** Subscribe to the shared radar. Returns the latest value and keeps it updated while mounted. */
export function useRadar(): Radar | null {
  const [r, setR] = useState<Radar | null>(radar);
  useEffect(() => {
    subs++;
    listeners.add(setR);
    if (radar) setR(radar);
    if (subs === 1) loop();
    return () => {
      subs--;
      listeners.delete(setR);
      if (subs === 0 && timer) { clearTimeout(timer); timer = null; }
    };
  }, []);
  return r;
}

/** The Scout score for one coin, from its own recent trades and the shared smart-wallet records.
 *  Works even when the coin is too quiet to appear in the global live window. */
export function useCoinScout(token: EToken | null | undefined): ScoutCoin | null {
  const radarNow = useRadar();
  const usd = usePoll(fetchHypeUsd, 60_000) ?? 0;
  const trades = usePoll(async () => (token ? fetchTrades(token.address, 300) : []), 15_000, [token?.address]);
  const [sc, setSc] = useState<ScoutCoin | null>(null);
  useEffect(() => {
    if (!token || !trades) { setSc(null); return; }
    const records = radarNow?.smart ?? new Map<string, WalletRecord>();
    setSc(scoutCoin(token, trades, records, usd || usdCache, Date.now()));
  }, [token, trades, usd, radarNow]);
  return sc;
}
