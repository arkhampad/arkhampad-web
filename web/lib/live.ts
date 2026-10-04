"use client";
// Live data from the ArkhamPad database (Supabase). Read-only, public data.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import type { Chain, Coin } from "./mock";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yvdudswzmdziwnfurwir.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY || "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";

let client: SupabaseClient | null = null;
export function db() {
  if (!client) client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

// Our launchpad runs on testnets for now; other DEX coins come from mainnets.
export const OWN_CHAINS = [84532, 46630];
export const chainName = (id: number): Chain => (id === 8453 || id === 84532 ? "Base" : "Robinhood");
export const isOwnChain = (id: number) => OWN_CHAINS.includes(id);

// ---------------------------------------------------------------- formatting
export function usd(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (a >= 1) return `$${v.toFixed(digits)}`;
  return `$${v.toFixed(2)}`;
}
export function price(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1) return `$${v.toFixed(v >= 100 ? 0 : 2)}`;
  // keep 3 significant digits, write long zero runs as 0.0₅123
  const s = v.toFixed(20);
  const m = s.match(/^0\.(0*)(\d{1,3})/);
  if (!m) return `$${v.toPrecision(3)}`;
  const zeros = m[1].length;
  if (zeros >= 4) return `$0.0${String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]).join("")}${m[2]}`;
  return `$0.${m[1]}${m[2]}`;
}
export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo`;
  return `${Math.floor(s / 86400 / 365)}y`;
}
export const short = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const count = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

// stable gradient colours from the address
const PALETTE = [["#7C5CFF", "#3A2BFF"], ["#FF8A3D", "#FF3D7F"], ["#2BB3FF", "#0066FF"], ["#E8559A", "#8A2BE2"], ["#3DDC97", "#00B37E"], ["#F5C542", "#FF7A00"], ["#5AD1C4", "#0E9F8E"], ["#B57BFF", "#6A3BFF"], ["#FF6B6B", "#E0245E"], ["#8FB3FF", "#4060FF"]];
const colours = (addr: string) => PALETTE[parseInt(addr.slice(-2), 16) % PALETTE.length] || PALETTE[0];
const sparkOf = (v: number[]) => (v.length >= 2 ? v : v.length === 1 ? [v[0], v[0]] : [1, 1]);

export type LiveCoin = Coin & {
  chainId: number; address: string; own: boolean; image: string | null;
  pool?: string | null; network?: string | null; dex?: string | null;
  priceNum: number | null; mcNum: number | null; volNum: number | null;
  phase?: number; startMc?: number; creator?: string; curve?: string; createdAt?: string | null;
};

type ExtRow = { chain_id: number; address: string; network: string; pool: string | null; dex: string | null; name: string; symbol: string; image: string | null; price_usd: number | null; mcap_usd: number | null; fdv_usd: number | null; liq_usd: number | null; vol_24h: number | null; change_24h: number | null; buys_24h: number | null; sells_24h: number | null; pool_created: string | null; spark: number[] | null };
type OwnRow = { chain_id: number; address: string; curve: string; creator: string; name: string; symbol: string; phase: number; price_usd: number; mc_usd: number; start_mc_usd: number; usdc_reserve: number; trades_count: number; created_at: string; volume_24h: number; change_24h_pct: number | null; buyers: number; metadata_uri: string };

export function fromExt(r: ExtRow): LiveCoin {
  const [c1, c2] = colours(r.address);
  const mc = r.mcap_usd ?? r.fdv_usd;
  const chg = Number(r.change_24h ?? 0);
  return {
    id: `${r.chain_id}-${r.address}`, name: r.name, tick: r.symbol, chain: chainName(r.chain_id), age: ago(r.pool_created),
    price: price(r.price_usd), chg, mc: usd(mc), vol: usd(r.vol_24h), liq: usd(r.liq_usd),
    holders: "—", trades: count((r.buys_24h ?? 0) + (r.sells_24h ?? 0)), c1, c2,
    spark: sparkOf((r.spark ?? []).map(Number)), progress: 100,
    chainId: r.chain_id, address: r.address, own: false, image: r.image, pool: r.pool, network: r.network, dex: r.dex,
    priceNum: r.price_usd, mcNum: mc, volNum: r.vol_24h, createdAt: r.pool_created,
  };
}

export function fromOwn(r: OwnRow): LiveCoin {
  const [c1, c2] = colours(r.address);
  const start = Number(r.start_mc_usd) || 0;
  const mc = Number(r.mc_usd) || 0;
  const target = start * (7500 / 4500); // graduation market cap
  const chg = r.change_24h_pct !== null && r.change_24h_pct !== undefined ? Number(r.change_24h_pct) : start ? ((mc - start) / start) * 100 : 0;
  return {
    id: `${r.chain_id}-${r.address}`, name: r.name, tick: r.symbol, chain: chainName(r.chain_id), age: ago(r.created_at),
    price: price(Number(r.price_usd)), chg, mc: usd(mc), vol: usd(Number(r.volume_24h)), liq: usd(Number(r.usdc_reserve)),
    holders: count(r.buyers), trades: count(r.trades_count), c1, c2,
    spark: sparkOf([start, mc]), progress: r.phase >= 1 ? 100 : target > start ? Math.max(0, Math.min(100, ((mc - start) / (target - start)) * 100)) : 0,
    chainId: r.chain_id, address: r.address, own: true, image: null, priceNum: Number(r.price_usd), mcNum: mc, volNum: Number(r.volume_24h),
    phase: r.phase, startMc: start, creator: r.creator, curve: r.curve, createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------- queries
export type Tab = "Trending" | "New" | "Gainers" | "Losers" | "Top volume" | "Launched here" | "Bonding" | "Graduated";
const CAT_WORDS: Record<string, string[]> = {
  AI: ["ai", "gpt", "bot", "agent", "neural", "robot", "intelligence"],
  Animals: ["dog", "cat", "frog", "pepe", "inu", "doge", "shib", "bear", "bull", "ape", "monkey", "fox", "wolf", "lion", "whale", "bird", "fish", "duck", "toad", "hamster", "penguin"],
  Gaming: ["game", "play", "quest", "pixel", "arcade", "guild"],
  Culture: ["meme", "trump", "elon", "music", "art", "movie", "based"],
};

export async function listCoins(tab: Tab, opts: { chain?: Chain | null; cat?: string | null; limit?: number; offset?: number; q?: string } = {}): Promise<LiveCoin[]> {
  const limit = opts.limit ?? 50, from = opts.offset ?? 0;
  const ownTab = tab === "Launched here" || tab === "Bonding" || tab === "Graduated";
  const ownIds = opts.chain ? OWN_CHAINS.filter((c) => chainName(c) === opts.chain) : OWN_CHAINS;
  const extIds = opts.chain === "Base" ? [8453] : opts.chain === "Robinhood" ? [4663] : [8453, 4663];
  const words = opts.cat ? CAT_WORDS[opts.cat] : null;
  const like = (col: string) => (words ? words.map((w) => `${col}.ilike.*${w}*`).join(",") : null);

  if (ownTab) {
    let q = db().from("coin_list").select("*").in("chain_id", ownIds);
    if (tab === "Bonding") q = q.lt("phase", 2);
    if (tab === "Graduated") q = q.eq("phase", 2);
    if (opts.q) q = q.or(`name.ilike.*${opts.q}*,symbol.ilike.*${opts.q}*,address.eq.${opts.q.toLowerCase()}`);
    const w = like("name"); if (w) q = q.or(w);
    const { data, error } = await q.order(tab === "Bonding" ? "mc_usd" : "created_at", { ascending: false }).range(from, from + limit - 1);
    if (error) throw error;
    return (data as OwnRow[]).map(fromOwn);
  }

  let q = db().from("ext_tokens").select("chain_id,address,network,pool,dex,name,symbol,image,price_usd,mcap_usd,fdv_usd,liq_usd,vol_24h,change_24h,buys_24h,sells_24h,pool_created,spark").in("chain_id", extIds);
  if (opts.q) q = q.or(`name.ilike.*${opts.q}*,symbol.ilike.*${opts.q}*,address.eq.${opts.q.toLowerCase()}`);
  const w = like("name"); if (w) q = q.or(w);
  if (tab === "Trending") q = q.not("trending_rank", "is", null).order("trending_rank", { ascending: true });
  else if (tab === "New") q = q.not("pool_created", "is", null).order("pool_created", { ascending: false });
  else if (tab === "Gainers") q = q.gte("vol_24h", 5000).not("change_24h", "is", null).order("change_24h", { ascending: false });
  else if (tab === "Losers") q = q.gte("vol_24h", 5000).not("change_24h", "is", null).order("change_24h", { ascending: true });
  else q = q.not("vol_24h", "is", null).order("vol_24h", { ascending: false });
  const { data, error } = await q.range(from, from + limit - 1);
  if (error) throw error;
  let rows = (data as ExtRow[]).map(fromExt);
  // When nothing is trending yet, fall back to volume.
  if (tab === "Trending" && rows.length === 0 && from === 0) return listCoins("Top volume", opts);
  return rows;
}

export async function getCoin(id: string): Promise<LiveCoin | null> {
  const m = id.match(/^(\d+)-(0x[0-9a-fA-F]{40})$/);
  if (!m) return null;
  const chainId = Number(m[1]), address = m[2].toLowerCase();
  if (isOwnChain(chainId)) {
    const { data } = await db().from("coin_list").select("*").eq("chain_id", chainId).eq("address", address).maybeSingle();
    return data ? fromOwn(data as OwnRow) : null;
  }
  const { data } = await db().from("ext_tokens").select("*").eq("chain_id", chainId).eq("address", address).maybeSingle();
  return data ? fromExt(data as ExtRow) : null;
}

export type LiveTrade = { id: string; who: string; act: "bought" | "sold"; amt: string; tick: string; up: boolean; ts: string; coin: string; chainId: number; usdcNum: number; coins: number };
export async function recentTrades(limit = 12, coin?: { chainId: number; address: string }): Promise<LiveTrade[]> {
  let q = db().from("trades").select("chain_id,tx_hash,log_index,coin,trader,is_buy,usdc,coins,ts").order("ts", { ascending: false }).limit(limit);
  if (coin) q = q.eq("chain_id", coin.chainId).eq("coin", coin.address);
  const { data, error } = await q;
  if (error || !data) return [];
  const coinsWanted = [...new Set(data.map((t) => t.coin))];
  const { data: names } = coinsWanted.length ? await db().from("coins").select("address,symbol").in("address", coinsWanted) : { data: [] };
  const sym = new Map((names ?? []).map((n: { address: string; symbol: string }) => [n.address, n.symbol]));
  return data.map((t) => ({
    id: `${t.chain_id}-${t.tx_hash}-${t.log_index}`, who: short(t.trader), act: t.is_buy ? "bought" : "sold", amt: usd(Number(t.usdc)),
    tick: sym.get(t.coin) ?? "?", up: t.is_buy, ts: t.ts, coin: t.coin, chainId: t.chain_id, usdcNum: Number(t.usdc), coins: Number(t.coins),
  }));
}

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export async function ownCandles(chainId: number, address: string, seconds: number): Promise<Candle[]> {
  const { data, error } = await db().rpc("coin_candles", { p_chain: chainId, p_coin: address, p_interval: seconds, p_limit: 200 });
  if (error || !data) return [];
  return (data as { t: string; o: number; h: number; l: number; c: number; v: number }[])
    .map((r) => ({ t: Date.parse(r.t), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: Number(r.v) })).reverse();
}

// GeckoTerminal OHLCV for coins on other DEXs (called from the browser).
const GT_FRAMES: Record<string, [string, number]> = { "1m": ["minute", 1], "5m": ["minute", 5], "15m": ["minute", 15], "1h": ["hour", 1], "4h": ["hour", 4], "1d": ["day", 1] };
export async function extCandles(network: string, pool: string, iv: string): Promise<Candle[]> {
  const [tf, agg] = GT_FRAMES[iv] ?? GT_FRAMES["15m"];
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pool}/ohlcv/${tf}?aggregate=${agg}&limit=200&currency=usd`, { headers: { accept: "application/json" } });
  if (!r.ok) return [];
  const j = await r.json();
  const list: number[][] = j?.data?.attributes?.ohlcv_list ?? [];
  return list.map((x) => ({ t: x[0] * 1000, o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] })).reverse();
}

// ---------------------------------------------------------------- live hooks
/** Calls `onChange` when a new trade lands (Supabase Realtime), with a slow poll as backup. */
export function useTradeFeed(onChange: () => void, filter?: { chainId: number; address: string }) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    let alive = true;
    const ch = db()
      .channel(`trades-${filter ? filter.address : "all"}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trades", ...(filter ? { filter: `coin=eq.${filter.address}` } : {}) }, () => alive && cb.current())
      .subscribe();
    const iv = setInterval(() => alive && cb.current(), 15_000);
    return () => { alive = false; clearInterval(iv); db().removeChannel(ch); };
  }, [filter?.address, filter?.chainId]);
}

export function useLive<T>(load: () => Promise<T>, deps: unknown[], every = 30_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tick = useRef(0);
  useEffect(() => {
    let alive = true;
    const run = () => {
      const n = ++tick.current;
      load().then((d) => { if (alive && n === tick.current) { setData(d); setError(null); } }).catch((e) => alive && setError(String(e?.message || e)));
    };
    run();
    const iv = every ? setInterval(run, every) : null;
    return () => { alive = false; if (iv) clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, reload: () => load().then(setData).catch(() => {}) };
}
