/**
 * Stocks: futures on shares, indices, commodities and currencies that builders run on Hyperliquid
 * (HIP-3 exchanges such as "xyz"). Same account, same trading key and builder code as crypto
 * futures; each exchange keeps its own margin, which lib/hltrade.ts tops up and sweeps back.
 *
 * Only exchanges that settle in USDC are listed: their dollars move to and from the main balance
 * with one transfer. Read-only data here.
 */
import { fetchPerpAccount, fetchPerpBook, fetchPerpOrders, info, type PerpAccount, type PerpMarket, type PerpOrder } from "./hl";

export type StockDex = { name: string; fullName: string; index: number };
export type StockMarket = PerpMarket & { category: Category; dexName: string };
export type Category = "Stocks" | "Indices" | "Commodities" | "FX" | "Pre-IPO" | "Crypto" | "Other";
export const CATEGORIES: Category[] = ["Stocks", "Indices", "Commodities", "FX", "Pre-IPO", "Crypto", "Other"];

/** USDC's spot token index: a HIP-3 exchange settling in it is listed. */
const USDC_TOKEN = 0;

/** Hyperliquid's own words for a market's kind, mapped to the few shown here. */
export function categoryOf(raw: string | null | undefined, coin: string): Category {
  const c = (raw ?? "").toLowerCase();
  if (/pre-?ipo|private/.test(c)) return "Pre-IPO";
  if (/stock|equit|share/.test(c)) return "Stocks";
  if (/index|indices/.test(c)) return "Indices";
  if (/commod|metal|gold|silver|energy|oil|agri/.test(c)) return "Commodities";
  if (/\bfx\b|forex|currenc/.test(c)) return "FX";
  if (/crypto|coin|token|defi|meme|layer|l1|l2/.test(c)) return "Crypto";
  // no annotation: a few well-known tickers still find their place
  const t = coin.slice(coin.indexOf(":") + 1).toUpperCase();
  if (/^(XYZ100|SP500|US500|NDX|NAS100|US30|DJI|DAX|JP225|NIKKEI|HSI|RUSSELL|SPX|USTECH)/.test(t)) return "Indices";
  if (/^(GOLD|SILVER|XAU|XAG|OIL|WTI|BRENT|CL|NATGAS|COPPER|PLATINUM|PALLADIUM)$/.test(t)) return "Commodities";
  if (/^(EUR|JPY|GBP|CHF|AUD|CAD|CNY|CNH|MXN|KRW|DXY)$/.test(t)) return "FX";
  return raw ? "Other" : "Stocks";
}

// The exchanges and the labels change rarely: asked once per 10 minutes.
let dexCache: { at: number; p: Promise<StockDex[]> } | null = null;
let noteCache: { at: number; p: Promise<Map<string, { category: string | null; displayName: string | null }>> } | null = null;
/** Exchanges found to settle in something else than USDC (not asked again). */
const skip = new Set<string>();
const TEN_MIN = 600_000;

export function fetchStockDexes(): Promise<StockDex[]> {
  if (dexCache && Date.now() - dexCache.at < TEN_MIN) return dexCache.p;
  const p = info<({ name: string; fullName: string } | null)[]>({ type: "perpDexs" }).then((rows) =>
    (Array.isArray(rows) ? rows : []).flatMap((d, index) => (d && d.name ? [{ name: d.name, fullName: d.fullName || d.name, index }] : []))
  );
  dexCache = { at: Date.now(), p };
  p.catch(() => (dexCache = null));
  return p;
}

function fetchNotes() {
  if (noteCache && Date.now() - noteCache.at < TEN_MIN) return noteCache.p;
  const p = info<[string, { category?: string; displayName?: string }][]>({ type: "perpConciseAnnotations" })
    .then((rows) => new Map((Array.isArray(rows) ? rows : []).map(([coin, a]) => [coin, { category: a?.category ?? null, displayName: a?.displayName ?? null }])))
    .catch(() => new Map<string, { category: string | null; displayName: string | null }>());
  noteCache = { at: Date.now(), p };
  return p;
}

/** Every USDC-settled HIP-3 market, busiest first. */
export async function fetchStockMarkets(signal?: AbortSignal): Promise<StockMarket[]> {
  const [dexes, notes] = await Promise.all([fetchStockDexes(), fetchNotes()]);
  const lists = await Promise.all(
    dexes
      .filter((d) => !skip.has(d.name))
      .map(async (d) => {
        try {
          const { markets: ms, collateralToken } = await fetchPerpBook(signal, d);
          if (collateralToken !== USDC_TOKEN) {
            skip.add(d.name);
            return [];
          }
          return ms.map((m): StockMarket => {
            const n = notes.get(m.coin);
            return { ...m, name: n?.displayName || m.name, category: categoryOf(n?.category, m.coin), dexName: d.fullName };
          });
        } catch {
          return [];
        }
      })
  );
  const all = lists.flat();
  if (!all.length && dexes.length) throw new Error("No stock markets answered.");
  return all.sort((a, b) => b.volume24h - a.volume24h);
}

/**
 * The user's stock positions over every USDC HIP-3 exchange as one account, and their open
 * orders (only asked where the account holds money: orders need margin there).
 */
export async function fetchStockAccount(user: string, dexes: string[], signal?: AbortSignal): Promise<{ account: PerpAccount; orders: PerpOrder[] }> {
  const accounts = await Promise.all(dexes.map((d) => fetchPerpAccount(user, signal, d).then((a) => ({ d, a })).catch(() => null)));
  const live = accounts.filter((x): x is { d: string; a: PerpAccount } => !!x);
  const orders = (await Promise.all(live.filter((x) => x.a.accountValue > 0).map((x) => fetchPerpOrders(user, signal, x.d).catch(() => [] as PerpOrder[])))).flat();
  return {
    account: {
      accountValue: live.reduce((s, x) => s + x.a.accountValue, 0),
      withdrawable: live.reduce((s, x) => s + x.a.withdrawable, 0),
      marginUsed: live.reduce((s, x) => s + x.a.marginUsed, 0),
      positions: live.flatMap((x) => x.a.positions),
    },
    orders,
  };
}

/** Dollars sitting on the HIP-3 exchanges (counted into the one trading balance on every screen). */
export async function fetchStockCash(user: string, signal?: AbortSignal): Promise<{ value: number; available: number }> {
  const dexes = await fetchStockDexes().catch(() => [] as StockDex[]);
  const rows = await Promise.all(dexes.filter((d) => !skip.has(d.name)).map((d) => fetchPerpAccount(user, signal, d.name).catch(() => null)));
  return rows.reduce((s, a) => (a ? { value: s.value + a.accountValue, available: s.available + a.withdrawable } : s), { value: 0, available: 0 });
}

/** The display name for a market id ("xyz:TSLA" → "TSLA"). */
export const tickerOf = (coin: string) => (coin.includes(":") ? coin.slice(coin.indexOf(":") + 1) : coin);
