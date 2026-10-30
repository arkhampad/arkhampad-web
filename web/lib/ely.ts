"use client";
// Elysium data for the site: every HYPE-paired token on Elysium (all launchpads), its trades and
// holders, written by the indexer (indexer/elysium.mjs → db/025_elysium.sql). Read-only.
import { useEffect, useRef, useState } from "react";
import { db } from "./live";

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
const TOKEN_COLS = "address,name,symbol,decimals,supply,uri,image,description,launchpad,venue,pool,manager,whype,token_is0,fee,tick_spacing,hooks,creator,ours,created_at,price_hype,mcap_hype,vol24_hype,buys24,sells24,change24,holders,top10_pct,last_trade_at";

export async function fetchTokens(): Promise<EToken[]> {
  if (MOCK) return (await mock()).tokens;
  // with the short-window columns when the database has them (db/027), without them otherwise
  const pick = (cols: string) => db().from("ely_tokens").select(cols).not("price_hype", "is", null).order("vol24_hype", { ascending: false }).limit(2000);
  let { data, error } = await pick(`${TOKEN_COLS},${WINDOW_COLS}`);
  if (error) ({ data, error } = await pick(TOKEN_COLS));
  if (error) throw error;
  return (data ?? []) as unknown as EToken[];
}
export async function fetchToken(address: string): Promise<EToken | null> {
  if (MOCK) return (await mock()).tokens.find((t: EToken) => t.address === address) ?? null;
  const { data } = await db().from("ely_tokens").select(TOKEN_COLS).eq("address", address.toLowerCase()).maybeSingle();
  return (data as unknown as EToken) ?? null;
}
export async function fetchHypeUsd(): Promise<number> {
  if (MOCK) return (await mock()).hypeUsd;
  const { data } = await db().from("ely_meta").select("v").eq("k", "hype_usd").maybeSingle();
  return Number(data?.v) || 0;
}
export async function fetchLiveTrades(limit = 30): Promise<ETrade[]> {
  if (MOCK) return (await mock()).trades.slice(0, limit);
  const { data } = await db().from("ely_trades").select("id,token,tx,log_index,at,side,hype,amount,price_hype,trader").order("at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  return (data ?? []) as ETrade[];
}
export async function fetchTrades(token: string, limit = 1500): Promise<ETrade[]> {
  if (MOCK) return (await mock()).trades.filter((t: ETrade) => t.token === token).slice(0, limit);
  const { data } = await db().from("ely_trades").select("id,token,tx,log_index,at,side,hype,amount,price_hype,trader").eq("token", token.toLowerCase()).order("at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  return (data ?? []) as ETrade[];
}
export async function fetchHolders(token: string, limit = 25): Promise<EHolder[]> {
  if (MOCK) return ((await mock()) as unknown as { holders?: Record<string, EHolder[]> }).holders?.[token] ?? [];
  const { data } = await db().from("ely_balances").select("holder,amount").eq("token", token.toLowerCase()).gt("amount", 0).order("amount", { ascending: false }).limit(limit);
  return (data ?? []) as EHolder[];
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
  const { data } = await db().from("ely_balances").select("token,amount").eq("holder", holder.toLowerCase()).gt("amount", 0).limit(500);
  return (data ?? []) as EHolding[];
}
export async function fetchTokensByAddress(addrs: string[]): Promise<EToken[]> {
  if (!addrs.length) return [];
  if (MOCK) return (await mock()).tokens.filter((t: EToken) => addrs.includes(t.address));
  const { data } = await db().from("ely_tokens").select(TOKEN_COLS).in("address", addrs.slice(0, 300));
  return (data ?? []) as unknown as EToken[];
}
export async function fetchCreated(creator: string): Promise<EToken[]> {
  if (MOCK) return [];
  const { data } = await db().from("ely_tokens").select(TOKEN_COLS).eq("creator", creator.toLowerCase()).eq("ours", true).order("created_at", { ascending: false }).limit(100);
  return (data ?? []) as unknown as EToken[];
}
export async function fetchMyTrades(trader: string, limit = 40): Promise<ETrade[]> {
  if (MOCK) return [];
  const { data } = await db().from("ely_trades").select("id,token,tx,log_index,at,side,hype,amount,price_hype,trader").eq("trader", trader.toLowerCase()).order("at", { ascending: false }).limit(limit);
  return (data ?? []) as ETrade[];
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
  const { data } = await db().from("ely_meta").select("v").eq("k", "stats").maybeSingle();
  return (data?.v as EStats) ?? null;
}
