/**
 * Predict: Hyperliquid's outcome markets (HIP-4). Each market is a Yes / No question that settles
 * at 1 USDC per winning share and 0 per losing one; a share's price (0.001 – 0.999) is the market's
 * odds. Fully paid, no leverage, no liquidation. Shares are whole numbers; the smallest order is $10.
 *
 * Naming: outcome `o`, side `s` (0 Yes, 1 No) → encoding 10·o + s. The book and prices use "#enc",
 * balances "+enc", orders the asset 100 000 000 + enc. Read-only data here; trading in hltrade.ts.
 */
import { info } from "./hl";

export const PREDICT_MIN_NOTIONAL = 10;
export const PREDICT_MIN_PX = 0.001;
export const PREDICT_MAX_PX = 0.999;
/** How far a market order may fill from the price (in odds points, absolute). */
export const PREDICT_SLIP = 0.03;

export type PredictSide = { name: string; side: 0 | 1; enc: number; coin: string; asset: number; mid: number | null };
export type PredictMarket = {
  outcome: number;
  /** What people read: "BTC above $105,000". */
  title: string;
  /** The raw name and rules Hyperliquid gives. */
  name: string;
  description: string;
  underlying: string | null;
  target: number | null;
  /** When it settles (ms), when known. */
  expiry: number | null;
  period: string | null;
  question: { id: number; name: string } | null;
  yes: PredictSide;
  no: PredictSide;
};

type RawOutcome = { outcome: number; name: string; description: string; sideSpecs: { name: string; token?: number }[]; quoteToken?: string };
type RawQuestion = { question: number; name: string; description: string; fallbackOutcome: number; namedOutcomes: number[]; settledNamedOutcomes: number[] };

/** "class:priceBinary|underlying:BTC|expiry:20261019-0600|targetPrice:105000|period:1d" → fields. */
export function parseDescription(d: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (d ?? "").split("|")) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** "20261019-0600" (UTC) → ms. */
export function parseExpiry(v: string | undefined): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:-(\d{2})(\d{2}))?$/.exec(v ?? "");
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 23), Number(m[5] ?? 59));
}

export const encOf = (outcome: number, side: 0 | 1) => outcome * 10 + side;
export const assetOf = (enc: number) => 100_000_000 + enc;

const usdText = (v: number) => (v >= 1000 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${Number(v.toPrecision(5))}`);

function titleOf(o: RawOutcome, f: Record<string, string>): string {
  const target = Number(f.targetPrice);
  if (/binary/i.test(f.class ?? "") && f.underlying && Number.isFinite(target) && target > 0) return `${f.underlying} above ${usdText(target)}`;
  return o.name || `Market ${o.outcome}`;
}

let metaCache: { at: number; p: Promise<{ outcomes: RawOutcome[]; questions: RawQuestion[] }> } | null = null;
function fetchMeta() {
  // markets come and go about once a day: asked once a minute
  if (metaCache && Date.now() - metaCache.at < 60_000) return metaCache.p;
  const p = info<{ outcomes?: RawOutcome[]; questions?: RawQuestion[] }>({ type: "outcomeMeta" }).then((m) => ({ outcomes: m?.outcomes ?? [], questions: m?.questions ?? [] }));
  metaCache = { at: Date.now(), p };
  p.catch(() => (metaCache = null));
  return p;
}

/** Every live outcome market with its Yes / No prices, soonest to settle first. */
export async function fetchPredictMarkets(): Promise<PredictMarket[]> {
  const [meta, mids] = await Promise.all([fetchMeta(), info<Record<string, string>>({ type: "allMids" }).catch(() => ({}) as Record<string, string>)]);
  const qOf = new Map<number, { id: number; name: string }>();
  for (const q of meta.questions) for (const o of q.namedOutcomes ?? []) if (!(q.settledNamedOutcomes ?? []).includes(o)) qOf.set(o, { id: q.question, name: q.name });
  const mid = (enc: number) => {
    const v = Number(mids[`#${enc}`]);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const side = (o: RawOutcome, s: 0 | 1): PredictSide => {
    const enc = encOf(o.outcome, s);
    return { name: o.sideSpecs?.[s]?.name || (s === 0 ? "Yes" : "No"), side: s, enc, coin: `#${enc}`, asset: assetOf(enc), mid: mid(enc) };
  };
  return meta.outcomes
    .filter((o) => (o.sideSpecs?.length ?? 0) >= 2)
    .map((o): PredictMarket => {
      const f = parseDescription(o.description);
      const yes = side(o, 0);
      const no = side(o, 1);
      // one side quoted: the other is its complement
      if (yes.mid === null && no.mid !== null) yes.mid = 1 - no.mid;
      if (no.mid === null && yes.mid !== null) no.mid = 1 - yes.mid;
      const target = Number(f.targetPrice);
      return {
        outcome: o.outcome,
        title: titleOf(o, f),
        name: o.name,
        description: o.description,
        underlying: f.underlying || null,
        target: Number.isFinite(target) && target > 0 ? target : null,
        expiry: parseExpiry(f.expiry),
        period: f.period || null,
        question: qOf.get(o.outcome) ?? null,
        yes,
        no,
      };
    })
    .sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity) || a.outcome - b.outcome);
}

export type PredictHolding = { coin: string; enc: number; outcome: number; side: 0 | 1; shares: number; free: number; cost: number; settled: boolean };
/** The user's shares: "+enc" while a market runs, "oN" once it has settled. */
export async function fetchPredictHoldings(user: string): Promise<PredictHolding[]> {
  const s = await info<{ balances?: { coin: string; total: string; hold: string; entryNtl: string }[] }>({ type: "spotClearinghouseState", user: user.toLowerCase() });
  const out: PredictHolding[] = [];
  for (const b of s?.balances ?? []) {
    const live = /^\+(\d+)$/.exec(b.coin);
    const done = /^o(\d+)$/.exec(b.coin);
    if (!live && !done) continue;
    const total = Number(b.total) || 0;
    if (total <= 0) continue;
    const n = Number((live ?? done)![1]);
    const hold = Number(b.hold) || 0;
    out.push({ coin: b.coin, enc: n, outcome: live ? Math.floor(n / 10) : n, side: (live ? n % 10 : 0) as 0 | 1, shares: total, free: Math.max(0, total - hold), cost: Number(b.entryNtl) || 0, settled: !!done });
  }
  return out;
}

export type PredictOrder = { coin: string; enc: number; oid: number; side: "B" | "A"; limitPx: number; size: number };
export async function fetchPredictOrders(user: string): Promise<PredictOrder[]> {
  const rows = await info<{ coin: string; oid: number; side: "B" | "A"; limitPx: string; sz: string }[]>({ type: "frontendOpenOrders", user: user.toLowerCase() });
  return (Array.isArray(rows) ? rows : [])
    .filter((o) => /^#\d+$/.test(o.coin))
    .map((o) => ({ coin: o.coin, enc: Number(o.coin.slice(1)), oid: o.oid, side: o.side, limitPx: Number(o.limitPx), size: Number(o.sz) }));
}

export type PredictFill = { coin: string; enc: number; px: number; sz: number; side: "B" | "A"; time: number; pnl: number; hash: string; tid: number };
export async function fetchPredictFills(user: string): Promise<PredictFill[]> {
  const rows = await info<{ coin: string; px: string; sz: string; side: "B" | "A"; time: number; closedPnl: string; hash: string; tid?: number }[]>({ type: "userFills", user: user.toLowerCase() });
  return (Array.isArray(rows) ? rows : [])
    .filter((f) => /^#\d+$/.test(f.coin))
    .slice(0, 50)
    .map((f) => ({ coin: f.coin, enc: Number(f.coin.slice(1)), px: Number(f.px), sz: Number(f.sz), side: f.side, time: f.time, pnl: Number(f.closedPnl) || 0, hash: f.hash, tid: Number(f.tid) || 0 }));
}

/**
 * Whole shares `usd` buys at `px`. An amount just at the $10 minimum would round under it, so it is
 * lifted to the fewest shares worth $10 (costing at most one share more than typed).
 */
export function sharesFor(usd: number, px: number): number {
  if (!(usd > 0) || !(px > 0)) return 0;
  const n = Math.floor(usd / px + 1e-9);
  if (n * px >= PREDICT_MIN_NOTIONAL || usd < PREDICT_MIN_NOTIONAL) return n;
  return Math.ceil(PREDICT_MIN_NOTIONAL / px - 1e-9);
}

/** An order price Hyperliquid takes: inside 0.001 – 0.999, at most 5 significant digits. */
export function predictPriceString(p: number): string {
  const v = Math.min(PREDICT_MAX_PX, Math.max(PREDICT_MIN_PX, p));
  return String(Number(v.toPrecision(5)));
}

/** "47%", and "47.2¢" for a price. */
export const chance = (p: number | null) => (p === null ? "—" : `${Math.round(p * 100)}%`);
export const cents = (p: number | null) => (p === null ? "—" : `${(p * 100).toFixed(p * 100 < 10 ? 2 : 1)}¢`);

/** "3h 12m", "5m 40s", "Ended". */
export function timeLeft(expiry: number | null, now = Date.now()): string {
  if (expiry === null) return "";
  const s = Math.floor((expiry - now) / 1000);
  if (s <= 0) return "Ended";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
