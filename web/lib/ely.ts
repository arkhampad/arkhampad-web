"use client";
// Elysium data for the site: every HYPE-paired token on Elysium (all launchpads), its trades and
// holders, written by the indexer (indexer/elysium.mjs → db/025_elysium.sql). Read-only.
import { useEffect, useRef, useState } from "react";

// Reads go through /api/ely-rest (cached at Cloudflare's edge and shared by every visitor), so the
// database sends each answer once every few seconds instead of once per visitor. Falls back to the
// database directly if that endpoint is unreachable.
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yvdudswzmdziwnfurwir.supabase.co";
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY || "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
async function rest<T>(path: string, ttl: number): Promise<T> {
  try {
    const r = await fetch(`/api/ely-rest?p=${encodeURIComponent(path)}&ttl=${ttl}`);
    if (r.ok) return (await r.json()) as T;
    if (r.status === 400 || r.status === 404) throw Object.assign(new Error(`rest ${r.status}`), { hard: r.status === 400 && (await r.text()).includes("column") });
  } catch (e) {
    if ((e as { hard?: boolean }).hard) throw e;
  }
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` } });
  if (!r.ok) throw new Error(`db ${r.status}`);
  return (await r.json()) as T;
}
/** A token's picture comes from /api/ely-img (cached for days), never inside the lists. */
const withImg = <T extends { address: string; image?: string | null }>(t: T): T => ({ ...t, image: `/api/ely-img?a=${t.address}` });
const TR_COLS = "id,token,tx,log_index,at,side,hype,amount,price_hype,trader";

export type EToken = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
  uri: string | null;
  image: string | null;
  description: string | null;
  launchpad: string | null;
  venue: "v3" | "v4";
  pool: string;
  manager: string | null;
  whype: string | null;
  token_is0: boolean;
  fee: number | null;
  tick_spacing: number | null;
  hooks: string | null;
  creator: string | null;
  ours: boolean;
  created_at: string | null;
  price_hype: number | null;
  mcap_hype: number | null;
  vol24_hype: number;
  buys24: number;
  sells24: number;
  change24: number | null;
  /** Shorter windows for Discover's time filter (db/027); missing until that file is run. */
  change5m?: number | null;
  change1h?: number | null;
  change6h?: number | null;
  vol5m_hype?: number;
  vol1h_hype?: number;
  vol6h_hype?: number;
  holders: number;
  top10_pct: number | null;
  last_trade_at: string | null;
};
export type ETrade = { id?: number; token: string; tx: string; log_index: number; at: string; side: "buy" | "sell"; hype: number; amount: number; price_hype: number | null; trader: string | null };
export type EHolder = { holder: string; amount: string };

const MOCK = process.env.NEXT_PUBLIC_ELY_MOCK === "1";
let mockData: Promise<{ tokens: EToken[]; trades: ETrade[]; hypeUsd: number }> | null = null;
const mock = () => (mockData ??= fetch("/ely-mock.json").then((r) => r.json()));

const WINDOW_COLS = "change5m,change1h,change6h,vol5m_hype,vol1h_hype,vol6h_hype";
const LIST_COLS = "address,name,symbol,decimals,supply,launchpad,venue,pool,manager,whype,token_is0,fee,tick_spacing,hooks,creator,ours,created_at,price_hype,mcap_hype,vol24_hype,buys24,sells24,change24,holders,top10_pct,last_trade_at";

export async function fetchTokens(): Promise<EToken[]> {
  if (MOCK) return (await mock()).tokens;
  // with the short-window columns when the database has them (db/027), without them otherwise
  const pick = (cols: string) => rest<EToken[]>(`ely_tokens?select=${cols}&price_hype=not.is.null&order=vol24_hype.desc&limit=2000`, 10);
  let list: EToken[];
  try { list = await pick(`${LIST_COLS},${WINDOW_COLS}`); } catch { list = await pick(LIST_COLS); }
  return list.map(withImg);
}
export async function fetchToken(address: string): Promise<EToken | null> {
  if (MOCK) return (await mock()).tokens.find((t: EToken) => t.address === address) ?? null;
  const rows = await rest<EToken[]>(`ely_tokens?select=${LIST_COLS},description&address=eq.${address.toLowerCase()}&limit=1`, 8);
  return rows[0] ? withImg(rows[0]) : null;
}
export async function fetchHypeUsd(): Promise<number> {
  if (MOCK) return (await mock()).hypeUsd;
  const rows = await rest<{ v: unknown }[]>("ely_meta?select=v&k=eq.hype_usd&limit=1", 30);
  return Number(rows[0]?.v) || 0;
}
export async function fetchLiveTrades(limit = 30): Promise<ETrade[]> {
  if (MOCK) return (await mock()).trades.slice(0, limit);
  return rest<ETrade[]>(`ely_trades?select=${TR_COLS}&order=at.desc,id.desc&limit=${limit}`, 3);
}
export async function fetchTrades(token: string, limit = 1500): Promise<ETrade[]> {
  if (MOCK) return (await mock()).trades.filter((t: ETrade) => t.token === token).slice(0, limit);
  return rest<ETrade[]>(`ely_trades?select=${TR_COLS}&token=eq.${token.toLowerCase()}&order=at.desc,id.desc&limit=${limit}`, limit > 200 ? 8 : 4);
}
export async function fetchHolders(token: string, limit = 25): Promise<EHolder[]> {
  if (MOCK) return ((await mock()) as unknown as { holders?: Record<string, EHolder[]> }).holders?.[token] ?? [];
  return rest<EHolder[]>(`ely_balances?select=holder,amount&token=eq.${token.toLowerCase()}&amount=gt.0&order=amount.desc&limit=${limit}`, 20);
}

/** Re-runs `load` every `ms` while the tab is visible; keeps the last good value. */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[] = []): T | undefined {
  const [v, setV] = useState<T>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let t: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        const x = await load();
        if (alive.current) setV(x);
      } catch {}
      if (alive.current) t = setTimeout(tick, ms);
    };
    const tick = () => (document.visibilityState === "visible" ? run() : (t = setTimeout(tick, 1500)));
    // a trade or deposit on this page: read again at once, then once more after the indexer has it
    const now = () => { clearTimeout(t); run(); setTimeout(() => { if (alive.current) { clearTimeout(t); run(); } }, 2500); };
    window.addEventListener("ap:balance", now);
    run();
    return () => {
      alive.current = false;
      clearTimeout(t);
      window.removeEventListener("ap:balance", now);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

// ---------------------------------------------------------------- formatting
export function money(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `$${(v / 1e3).toFixed(1)}K`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  if (a >= 1) return `$${v.toFixed(2)}`;
  if (a === 0) return "$0";
  return `$${v.toPrecision(2)}`;
}
/** Tiny prices as 0.0₅123 (subscript zero count). */
export function tinyPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1) return `$${v.toFixed(v >= 100 ? 2 : 4)}`;
  const m = v.toFixed(20).match(/^0\.(0*)(\d{1,4})/);
  if (!m) return `$${v.toPrecision(4)}`;
  const zeros = m[1].length;
  if (zeros < 4) return `$${v.toFixed(zeros + 4)}`;
  const sub = String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("");
  return `$0.0${sub}${m[2]}`;
}
export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const s = a >= 1000 ? Math.round(a).toLocaleString("en-US") : a >= 100 ? a.toFixed(0) : a.toFixed(1);
  return `${v >= 0 ? "+" : "-"}${s}%`;
}
export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
export const short = (a: string | null | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
export const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 }));

export const PADS: Record<string, { color: string; short: string }> = {
  ArkhamPad: { color: "#3FE3D4", short: "A" },
  Boxa: { color: "#5AA9FF", short: "B" },
  ElysPump: { color: "#B08CFF", short: "E" },
  Kleos: { color: "#F2B24A", short: "K" },
  Uniswap: { color: "#FF4FB0", short: "U" },
};
export const padOf = (t: Pick<EToken, "launchpad" | "ours">) => (t.ours ? "ArkhamPad" : t.launchpad || "Other");
export const padColor = (name: string) => PADS[name]?.color ?? "#8A94A6";

/** A stable two-colour gradient for a token without a picture. */
export function tokenColors(address: string): [string, string] {
  let h = 0;
  for (let i = 2; i < Math.min(address.length, 14); i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  const a = h % 360;
  return [`hsl(${a} 70% 58%)`, `hsl(${(a + 48) % 360} 75% 42%)`];
}

// ---------------------------------------------------------------- one wallet ("You" page)
export type EHolding = { token: string; amount: string };
export async function fetchHoldings(holder: string): Promise<EHolding[]> {
  if (MOCK) return [];
  return rest<EHolding[]>(`ely_balances?select=token,amount&holder=eq.${holder.toLowerCase()}&amount=gt.0&limit=500`, 4);
}
export async function fetchTokensByAddress(addrs: string[]): Promise<EToken[]> {
  if (!addrs.length) return [];
  if (MOCK) return (await mock()).tokens.filter((t: EToken) => addrs.includes(t.address));
  const list = addrs.slice(0, 300).map((a) => a.toLowerCase());
  const out: EToken[] = [];
  for (let i = 0; i < list.length; i += 60) {
    out.push(...(await rest<EToken[]>(`ely_tokens?select=${LIST_COLS}&address=in.(${list.slice(i, i + 60).join(",")})`, 10)));
  }
  return out.map(withImg);
}
export async function fetchCreated(creator: string): Promise<EToken[]> {
  if (MOCK) return [];
  const rows = await rest<EToken[]>(`ely_tokens?select=${LIST_COLS}&creator=eq.${creator.toLowerCase()}&ours=eq.true&order=created_at.desc&limit=100`, 10);
  return rows.map(withImg);
}
export async function fetchMyTrades(trader: string, limit = 40): Promise<ETrade[]> {
  if (MOCK) return [];
  return rest<ETrade[]>(`ely_trades?select=${TR_COLS}&trader=eq.${trader.toLowerCase()}&order=at.desc&limit=${limit}`, 4);
}

// ---------------------------------------------------------------- network stats (Stats page)
export type EStats = {
  updated: string;
  tokens: number; tokens_ours: number; holders: number;
  trades_all: number; trades_24h: number; traders_24h: number; traders_all: number;
  vol_all: number; vol_24h: number; vol_7d: number;
  ours: { coins: number; vol_all: number; vol_24h: number; creator_fees: number };
  daily: { d: string; vol: number; trades: number; traders: number; ours_vol: number; new_tokens: number; new_ours: number }[];
  hourly: { h: string; vol: number; trades: number }[];
  top: { address: string; name: string; symbol: string; image: string | null; pad: string; ours: boolean; vol_7d: number; trades_7d: number }[];
};
export async function fetchStats(): Promise<EStats | null> {
  if (MOCK) return ((await mock()) as unknown as { stats?: EStats }).stats ?? null;
  const rows = await rest<{ v: EStats }[]>("ely_meta?select=v&k=eq.stats&limit=1", 60);
  return rows[0]?.v ?? null;
}
