/**
 * Live-only agents for the Arena: what the order book, funding, premium and open interest say right now.
 * These can't be tested on old prices (the book and funding of last week are gone), so the Brain learns
 * how much to trust them from live rounds, not from history.
 */
import { info } from "./hl";

export const LIVE_AGENTS = [
  { id: "book", name: "Order book", group: "Live" },
  { id: "fund", name: "Funding", group: "Live" },
  { id: "prem", name: "Premium", group: "Live" },
  { id: "oi", name: "Open interest", group: "Live" },
  { id: "day", name: "Day trend", group: "Live" },
] as const;

export type LiveCtx = { book: number; fund: number; prem: number; oi: number; oiPrev: number; px: number; pxPrev: number; day: number; vol: number; t: number };

const clamp = (v: number) => (v > 1 ? 1 : v < -1 ? -1 : Number.isFinite(v) ? v : 0);

export type Ctx = { name: string; px: number; funding: number; premium: number; oi: number; day: number; vol: number };

/** Every perp market's mark price, funding, premium, open interest and 24h volume in one request. */
export async function fetchCtxs(): Promise<Ctx[]> {
  const r = await info<[{ universe: { name: string; isDelisted?: boolean }[] }, { markPx: string; funding: string; premium: string | null; openInterest: string; prevDayPx: string; dayNtlVlm: string }[]]>({ type: "metaAndAssetCtxs" });
  return r[0].universe.map((u, i) => {
    const c = r[1][i];
    const px = Number(c.markPx);
    return { name: u.name, px, funding: Number(c.funding), premium: Number(c.premium ?? 0), oi: Number(c.openInterest) * px, day: Number(c.prevDayPx) > 0 ? px / Number(c.prevDayPx) - 1 : 0, vol: Number(c.dayNtlVlm), del: !!u.isDelisted } as Ctx & { del: boolean };
  }).filter((c) => !(c as Ctx & { del: boolean }).del && c.px > 0);
}

/** Bid minus ask size in the top 10 levels, from -1 (all sellers) to 1 (all buyers). */
export async function fetchImbalance(coin: string): Promise<number> {
  const r = await info<{ levels: [{ px: string; sz: string }[], { px: string; sz: string }[]] }>({ type: "l2Book", coin });
  const sum = (l: { px: string; sz: string }[]) => l.slice(0, 10).reduce((s, x) => s + Number(x.sz) * Number(x.px), 0);
  const b = sum(r.levels[0]), a = sum(r.levels[1]);
  return b + a > 0 ? (b - a) / (b + a) : 0;
}

/** Turns one coin's live numbers into the five agent scores (positive = up). */
export function liveScores(l: LiveCtx | undefined): number[] {
  if (!l) return [0, 0, 0, 0, 0];
  const dOi = l.oiPrev > 0 ? l.oi / l.oiPrev - 1 : 0;
  const dPx = l.pxPrev > 0 ? l.px / l.pxPrev - 1 : 0;
  return [
    clamp(l.book * 1.5), // more bids than asks near the price: buyers are leaning in
    clamp(-(l.fund - 0.0000125) / 0.00005), // very high funding means crowded longs: fade it
    clamp(l.prem / 0.001), // futures above the spot index: buying pressure
    clamp(Math.sign(dPx) * (dOi / 0.004)), // open interest rising with the move: the move has fuel
    clamp(l.day / 0.05 * 0.5), // today's direction, lightly followed
  ];
}
