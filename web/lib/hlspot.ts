/**
 * Spot on Hyperliquid: coins bought and held outright (no leverage), against USDC. Read-only
 * data here; buying and selling is in lib/hltrade.ts (makeSpotTrade). Same account, same builder
 * code as futures (0.2% on spot).
 *
 * Hyperliquid keeps spot and futures dollars apart unless the account is "unified": then one USDC
 * balance pays for both. ArkhamPad reads which it is (accountMode) and, for a standard account,
 * moves dollars between the two by itself when a trade needs them.
 */
import { info, type BookLevel } from "./hl";

/** Hyperliquid's smallest spot order, in dollars. */
export const SPOT_MIN_NOTIONAL = 10;
/** How far a market order may fill from the price. */
export const SPOT_SLIP = 0.015;

export type SpotMarket = {
  /** The pair as Hyperliquid's API names it ("PURR/USDC", "@107"): for prices, charts, the book. */
  pair: string;
  /** Spot universe index; orders use asset 10000 + index. */
  index: number;
  asset: number;
  /** The coin's ticker (HYPE, UBTC…) and long name when Hyperliquid has one. */
  base: string;
  fullName: string | null;
  szDecimals: number;
  mark: number;
  prevDay: number;
  change24h: number | null;
  volume24h: number;
  marketCap: number | null;
};

export type SpotBalance = { coin: string; token: number; total: number; hold: number; free: number; entryNtl: number };
export type AccountMode = "standard" | "unified" | "portfolio";

const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));

type SpotMeta = {
  universe: { tokens: [number, number]; name: string; index: number; isCanonical: boolean }[];
  tokens: { name: string; szDecimals: number; weiDecimals: number; index: number; fullName: string | null }[];
};
type SpotCtx = { coin: string; prevDayPx: string; dayNtlVlm: string; markPx: string; midPx: string | null; circulatingSupply: string };

/** Every coin traded against USDC on Hyperliquid spot, busiest first. */
export async function fetchSpotMarkets(signal?: AbortSignal): Promise<SpotMarket[]> {
  const [meta, ctxs] = await info<[SpotMeta, SpotCtx[]]>({ type: "spotMetaAndAssetCtxs" }, signal);
  const tokens = new Map(meta.tokens.map((t) => [t.index, t]));
  const usdc = meta.tokens.find((t) => t.name === "USDC")?.index ?? 0;
  const ctxOf = new Map(ctxs.map((c) => [c.coin, c]));
  const out: SpotMarket[] = [];
  for (const u of meta.universe) {
    if (u.tokens[1] !== usdc) continue;
    const t = tokens.get(u.tokens[0]);
    const c = ctxOf.get(u.name);
    if (!t || !c) continue;
    const mark = num(c.markPx) || num(c.midPx);
    if (mark <= 0) continue;
    const prev = num(c.prevDayPx);
    const supply = num(c.circulatingSupply);
    out.push({
      pair: u.name,
      index: u.index,
      asset: 10000 + u.index,
      base: t.name,
      fullName: t.fullName || null,
      szDecimals: t.szDecimals,
      mark,
      prevDay: prev,
      change24h: prev > 0 ? (mark / prev - 1) * 100 : null,
      volume24h: num(c.dayNtlVlm),
      marketCap: supply > 0 ? supply * mark : null,
    });
  }
  return out.sort((a, b) => b.volume24h - a.volume24h);
}

/** The user's spot coins and dollars (free = what isn't held by open orders). */
export async function fetchSpotBalances(user: string, signal?: AbortSignal): Promise<SpotBalance[]> {
  const s = await info<{ balances?: { coin: string; token: number; total: string; hold: string; entryNtl: string }[] }>({ type: "spotClearinghouseState", user: user.toLowerCase() }, signal);
  return (s?.balances ?? [])
    .map((b) => {
      const total = num(b.total);
      const hold = num(b.hold);
      return { coin: b.coin, token: Number(b.token), total, hold, free: Math.max(0, total - hold), entryNtl: num(b.entryNtl) };
    })
    .filter((b) => b.total > 0);
}

/** Whether one USDC balance serves spot and futures ("unified") or they're kept apart ("standard"). */
export async function fetchAccountMode(user: string, signal?: AbortSignal): Promise<AccountMode> {
  const m = await info<string>({ type: "userAbstraction", user: user.toLowerCase() }, signal).catch(() => "default");
  if (m === "unifiedAccount") return "unified";
  if (m === "portfolioMargin") return "portfolio";
  return "standard";
}

export type SpotFill = { pair: string; px: number; sz: number; side: "B" | "A"; time: number; fee: number; hash: string; tid: number };
/** The user's latest spot trades (Hyperliquid names spot fills by pair: "@107", "PURR/USDC"). */
export async function fetchSpotFills(user: string, signal?: AbortSignal): Promise<SpotFill[]> {
  const rows = await info<{ coin: string; px: string; sz: string; side: "B" | "A"; time: number; fee: string; hash: string; tid?: number }[]>({ type: "userFills", user: user.toLowerCase() }, signal);
  return (Array.isArray(rows) ? rows : [])
    .filter((f) => f.coin.startsWith("@") || f.coin.includes("/"))
    .slice(0, 50)
    .map((f) => ({ pair: f.coin, px: num(f.px), sz: num(f.sz), side: f.side, time: f.time, fee: num(f.fee), hash: f.hash, tid: Number(f.tid) || 0 }));
}

/** A spot price in Hyperliquid's format: at most 5 significant digits and (8 − szDecimals) decimals. */
export function spotPriceString(price: number, szDecimals: number): string {
  if (!(price > 0)) return "0";
  if (Number.isInteger(price) && price >= 1e5) return String(price);
  const sig = Number(price.toPrecision(5));
  const maxDec = Math.max(0, 8 - szDecimals);
  return sig.toFixed(maxDec).replace(/\.?0+$/, "") || "0";
}

/** Spot balances are named by token ("HYPE"); markets by pair. */
export const holdingOf = (balances: SpotBalance[], m: SpotMarket | null) => (m ? balances.find((b) => b.coin === m.base) ?? null : null);
export const usdcOf = (balances: SpotBalance[]) => balances.find((b) => b.coin === "USDC") ?? null;

export type { BookLevel };

/**
 * One trading balance for the screens: futures and spot dollars together (a standard account's two
 * sides are moved between by ArkhamPad when a trade needs it). `value` counts open positions too.
 */
export function combineCash(
  perp: { accountValue: number; withdrawable: number } | null,
  balances: SpotBalance[] | null,
  mode: AccountMode | null
): { value: number; available: number; spotUsdc: number } | null {
  if (!perp || !balances || !mode) return null;
  const u = usdcOf(balances);
  const spotTotal = u?.total ?? 0;
  const spotFree = u?.free ?? 0;
  if (mode === "standard") return { value: perp.accountValue + spotTotal, available: perp.withdrawable + spotFree, spotUsdc: spotTotal };
  // one balance: Hyperliquid reports it on the spot side
  return { value: Math.max(perp.accountValue, spotTotal), available: spotFree, spotUsdc: spotTotal };
}
