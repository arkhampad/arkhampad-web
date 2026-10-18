/**
 * Futures on Hyperliquid: ArkhamPad's own screen, Hyperliquid's exchange. Markets, prices, charts
 * and the user's account come from Hyperliquid's free public API; every order carries ArkhamPad's
 * builder code (0.07%). The money stays in the user's own Hyperliquid account (their ArkhamPad
 * address). Trading itself (orders, money in and out) is in lib/hltrade.ts.
 */
import { perpsBlocked } from "./hlgeo.js";

export const HL_API = "https://api.hyperliquid.xyz";
/**
 * ArkhamPad's Hyperliquid builder address (the treasury): it receives the 0.07% fee. Hyperliquid
 * requires it to hold at least 100 USDC in its own perps account.
 */
export const HL_BUILDER = ((process.env.NEXT_PUBLIC_HL_BUILDER || "0xd9D46EB26c9D753135683b7736FC2be097e7B099").toLowerCase()) as `0x${string}`;
/** Highest leverage offered (a market's own limit can be lower). */
export const MAX_LEV = 20;
export const DEFAULT_LEV = 5;
/** ArkhamPad's fee on every futures trade (builder fee, tenths of a basis point: 70 = 0.07%). */
export const BUILDER_FEE_TENTHS_BP = 70;
export const BUILDER_FEE = 0.0007;
/** Hyperliquid's own taker fee at the base tier (about; it falls with volume). */
export const HL_TAKER_FEE = 0.00045;
/** Hyperliquid's smallest order, in dollars of position. */
export const MIN_NOTIONAL = 10;

export type PerpMarket = {
  coin: string;
  index: number;
  szDecimals: number;
  /** Hyperliquid's limit for this market. */
  hlMaxLev: number;
  /** What ArkhamPad allows: the lower of 20x and Hyperliquid's limit. */
  maxLev: number;
  onlyIsolated: boolean;
  mark: number;
  prevDay: number;
  change24h: number | null;
  volume24h: number;
  openInterestUsd: number;
  funding: number;
};

export type PerpPosition = {
  coin: string;
  /** Coins: positive long, negative short. */
  size: number;
  side: "long" | "short";
  entry: number;
  value: number;
  pnl: number;
  roe: number;
  liq: number | null;
  lev: number;
  margin: number;
  funding: number;
};

export type PerpAccount = { accountValue: number; withdrawable: number; marginUsed: number; positions: PerpPosition[] };
export type PerpOrder = { coin: string; oid: number; side: "B" | "A"; type: string; triggerPx: number | null; limitPx: number; size: number; reduceOnly: boolean; tpsl: "tp" | "sl" | null };
export type PerpFill = { coin: string; px: number; sz: number; side: "B" | "A"; time: number; dir: string; pnl: number; fee: number; hash: string; tid: number };

const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));

export async function info<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${HL_API}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!r.ok) throw new Error(`Hyperliquid ${r.status}`);
  return (await r.json()) as T;
}

type Universe = { name: string; szDecimals: number; maxLeverage: number; onlyIsolated?: true; isDelisted?: true; marginMode?: string }[];
type Ctx = { prevDayPx: string; dayNtlVlm: string; markPx: string; funding: string; openInterest: string };

/** Every live crypto futures market, busiest first. */
export async function fetchPerpMarkets(signal?: AbortSignal): Promise<PerpMarket[]> {
  const [meta, ctxs] = await info<[{ universe: Universe }, Ctx[]]>({ type: "metaAndAssetCtxs" }, signal);
  const out: PerpMarket[] = [];
  meta.universe.forEach((u, index) => {
    const c = ctxs[index];
    if (!c || u.isDelisted) return;
    const mark = num(c.markPx);
    const prev = num(c.prevDayPx);
    if (mark <= 0) return;
    out.push({
      coin: u.name,
      index,
      szDecimals: u.szDecimals,
      hlMaxLev: u.maxLeverage,
      maxLev: Math.max(1, Math.min(MAX_LEV, u.maxLeverage)),
      onlyIsolated: !!u.onlyIsolated || u.marginMode === "strictIsolated" || u.marginMode === "noCross",
      mark,
      prevDay: prev,
      change24h: prev > 0 ? (mark / prev - 1) * 100 : null,
      volume24h: num(c.dayNtlVlm),
      openInterestUsd: num(c.openInterest) * mark,
      funding: num(c.funding),
    });
  });
  return out.sort((a, b) => b.volume24h - a.volume24h);
}

export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Interval = (typeof INTERVALS)[number];
const INTERVAL_SEC: Record<Interval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

/** Prices: 5 significant digits like Hyperliquid, thousands separated. */
export function px(v: number | null | undefined): string {
  if (!v || !Number.isFinite(v)) return "—";
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return Number(v.toPrecision(5)).toLocaleString("en-US", { maximumSignificantDigits: 5 });
}

/** Candles for the chart, in ArkhamPad's Candle shape (time in ms, volume in dollars). */
export async function fetchPerpCandles(coin: string, interval: Interval, bars = 500): Promise<{ t: number; o: number; h: number; l: number; c: number; v: number }[]> {
  const sec = INTERVAL_SEC[interval];
  const end = Date.now();
  const rows = await info<{ t: number; o: string; h: string; l: string; c: string; v: string }[]>({ type: "candleSnapshot", req: { coin, interval, startTime: end - sec * 1000 * bars, endTime: end } });
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ t: r.t, o: num(r.o), h: num(r.h), l: num(r.l), c: num(r.c), v: num(r.v) * num(r.c) }))
    .filter((r) => r.c > 0)
    .sort((a, b) => a.t - b.t);
}

export type BookLevel = { px: number; sz: number };
export async function fetchBook(coin: string, signal?: AbortSignal): Promise<{ bids: BookLevel[]; asks: BookLevel[] }> {
  const r = await info<{ levels: [{ px: string; sz: string }[], { px: string; sz: string }[]] }>({ type: "l2Book", coin }, signal);
  const side = (l: { px: string; sz: string }[] | undefined) => (l ?? []).map((x) => ({ px: num(x.px), sz: num(x.sz) }));
  return { bids: side(r?.levels?.[0]), asks: side(r?.levels?.[1]) };
}

type Clearing = {
  marginSummary: { accountValue: string; totalMarginUsed: string };
  withdrawable: string;
  assetPositions: {
    position: {
      coin: string;
      szi: string;
      entryPx: string;
      positionValue: string;
      unrealizedPnl: string;
      returnOnEquity: string;
      liquidationPx: string | null;
      marginUsed: string;
      leverage: { value: number };
      cumFunding: { sinceOpen: string };
    };
  }[];
};

/** The user's futures account: money in it, what can be moved out, open positions. */
export async function fetchPerpAccount(user: string, signal?: AbortSignal): Promise<PerpAccount> {
  const s = await info<Clearing>({ type: "clearinghouseState", user: user.toLowerCase() }, signal);
  return {
    accountValue: num(s.marginSummary?.accountValue),
    withdrawable: num(s.withdrawable),
    marginUsed: num(s.marginSummary?.totalMarginUsed),
    positions: (s.assetPositions ?? [])
      .map(({ position: p }) => {
        const size = num(p.szi);
        return {
          coin: p.coin,
          size,
          side: (size >= 0 ? "long" : "short") as "long" | "short",
          entry: num(p.entryPx),
          value: num(p.positionValue),
          pnl: num(p.unrealizedPnl),
          roe: num(p.returnOnEquity) * 100,
          liq: p.liquidationPx === null ? null : num(p.liquidationPx) || null,
          lev: num(p.leverage?.value),
          margin: num(p.marginUsed),
          // Hyperliquid counts funding paid as positive: shown as money in (+) / out (−)
          funding: -num(p.cumFunding?.sinceOpen),
        };
      })
      .filter((p) => p.size !== 0),
  };
}

type RawOrder = { coin: string; oid: number; side: "B" | "A"; orderType: string; isTrigger: boolean; triggerPx: string; limitPx: string; sz: string; reduceOnly: boolean };

export async function fetchPerpOrders(user: string, signal?: AbortSignal): Promise<PerpOrder[]> {
  const rows = await info<RawOrder[]>({ type: "frontendOpenOrders", user: user.toLowerCase() }, signal);
  return (Array.isArray(rows) ? rows : []).map((o) => ({
    coin: o.coin,
    oid: o.oid,
    side: o.side,
    type: o.orderType,
    triggerPx: o.isTrigger ? num(o.triggerPx) : null,
    limitPx: num(o.limitPx),
    size: num(o.sz),
    reduceOnly: o.reduceOnly,
    tpsl: /^Take Profit/.test(o.orderType) ? "tp" : /^Stop/.test(o.orderType) ? "sl" : null,
  }));
}

export async function fetchPerpFills(user: string, signal?: AbortSignal): Promise<PerpFill[]> {
  const rows = await info<{ coin: string; px: string; sz: string; side: "B" | "A"; time: number; dir: string; closedPnl: string; fee: string; hash: string; tid?: number }[]>(
    { type: "userFills", user: user.toLowerCase() },
    signal
  );
  return (Array.isArray(rows) ? rows : [])
    .slice(0, 50)
    .map((f) => ({ coin: f.coin, px: num(f.px), sz: num(f.sz), side: f.side, time: f.time, dir: f.dir, pnl: num(f.closedPnl), fee: num(f.fee), hash: f.hash, tid: Number(f.tid) || 0 }));
}

// ------------------------------------------------------------------ order math

/**
 * About where an isolated position is liquidated (Hyperliquid's formula, ignoring funding and
 * fees): maintenance margin is half the initial margin at the market's highest leverage.
 */
export function liqPrice(side: "long" | "short", entry: number, lev: number, hlMaxLev: number): number {
  const l = 1 / (2 * hlMaxLev);
  const room = 1 / lev - l;
  if (room <= 0) return entry;
  return side === "long" ? entry * (1 - room / (1 - l)) : entry * (1 + room / (1 + l));
}

/** A coin amount in Hyperliquid's format: at most szDecimals decimals, rounded down. */
export function sizeString(coins: number, szDecimals: number): string {
  const f = 10 ** szDecimals;
  const v = Math.floor(coins * f + 1e-9) / f;
  return v.toFixed(szDecimals).replace(/\.?0+$/, "") || "0";
}

/**
 * A price in Hyperliquid's format: at most 5 significant digits and at most (6 − szDecimals)
 * decimals; whole numbers are always allowed.
 */
export function priceString(price: number, szDecimals: number): string {
  if (!(price > 0)) return "0";
  if (Number.isInteger(price) && price >= 1e5) return String(price);
  const sig = Number(price.toPrecision(5));
  const maxDec = Math.max(0, 6 - szDecimals);
  return sig.toFixed(maxDec).replace(/\.?0+$/, "");
}

export type OrderPlan = { notional: number; coins: string; liq: number; fees: number; ok: boolean; why: string | null };

/** What an order of `margin` dollars at `lev`x would be (`entryPx`: a limit order's price). */
export function planOrder(m: PerpMarket, side: "long" | "short", margin: number, lev: number, available: number, entryPx = m.mark): OrderPlan {
  const notional = margin * lev;
  const at = entryPx > 0 ? entryPx : m.mark;
  const coins = sizeString(notional / at, m.szDecimals);
  const fees = notional * (HL_TAKER_FEE + BUILDER_FEE);
  const liq = liqPrice(side, at, lev, m.hlMaxLev);
  let why: string | null = null;
  if (!(margin > 0)) why = "Enter an amount.";
  else if (notional < MIN_NOTIONAL) why = `The smallest position is $${MIN_NOTIONAL} (amount × leverage).`;
  else if (Number(coins) <= 0) why = "That amount is too small for this coin.";
  else if (lev > m.maxLev) why = `Up to ${m.maxLev}x on ${m.coin}.`;
  else if (margin + fees > available + 1e-9) why = "Not enough in your futures balance. Add money first.";
  return { notional, coins, liq, fees, ok: !why, why };
}

// ------------------------------------------------------------------ where the visitor is

/**
 * Whether futures are offered where the visitor is (functions/geo.js). If the answer can't be
 * had, trading stays hidden: better a retry than leverage where it isn't allowed.
 */
export async function futuresAllowedHere(): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch("/geo", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { futures?: boolean; country?: string; region?: string };
        if (typeof j.futures === "boolean") return j.futures && !perpsBlocked(j.country, j.region);
      }
    } catch {
      /* try again */
    }
    await new Promise((res) => setTimeout(res, 800));
  }
  return false;
}
