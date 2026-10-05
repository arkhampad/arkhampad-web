"use client";
// Live data from the ArkhamPad database (Supabase). Read-only, public data.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import type { Chain, Coin } from "./types";
import { shareCoinCard, prepareCard } from "./share";
import { NETS } from "./chain";
export { prepareCard };

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yvdudswzmdziwnfurwir.supabase.co";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY || "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";

let client: SupabaseClient | null = null;
export function db() {
  if (!client) client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

// Our launchpad runs on testnets for now; other DEX coins come from mainnets.
export const OWN_CHAINS = NETS.map((n) => n.id);
export const chainName = (id: number): Chain => (id === 8453 || id === 84532 ? "Base" : id === 56 || id === 97 ? "BNB" : id === 5042 ? "Arc" : "Robinhood");
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
  about?: { description?: string; x?: string; telegram?: string; website?: string }; feeMode?: number;
};

/** Creator-written details stored with the coin (description and links). */
export function parseMeta(uri: string | null | undefined): LiveCoin["about"] {
  if (!uri || !uri.startsWith("data:application/json;base64,")) return undefined;
  try {
    const j = JSON.parse(decodeURIComponent(escape(atob(uri.slice(29)))));
    const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
    return { description: str(j.description, 280), x: str(j.x, 100), telegram: str(j.telegram, 100), website: str(j.website, 100) };
  } catch { return undefined; }
}

type ExtRow = { change_5m?: number | null; chain_id: number; address: string; network: string; pool: string | null; dex: string | null; name: string; symbol: string; image: string | null; price_usd: number | null; mcap_usd: number | null; fdv_usd: number | null; liq_usd: number | null; vol_24h: number | null; change_24h: number | null; buys_24h: number | null; sells_24h: number | null; pool_created: string | null; spark: number[] | null };
type OwnRow = { image_url?: string | null; fee_mode?: number; lock_seconds?: number; chain_id: number; address: string; curve: string; creator: string; name: string; symbol: string; phase: number; price_usd: number; mc_usd: number; start_mc_usd: number; usdc_reserve: number; trades_count: number; created_at: string; volume_24h: number; change_24h_pct: number | null; buyers: number; metadata_uri: string };

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
    chainId: r.chain_id, address: r.address, own: true, image: r.image_url ?? null, priceNum: Number(r.price_usd), mcNum: mc, volNum: Number(r.volume_24h),
    phase: r.phase, startMc: start, creator: r.creator, curve: r.curve, createdAt: r.created_at,
    about: parseMeta(r.metadata_uri), feeMode: r.fee_mode,
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
  if (opts.q) opts = { ...opts, q: opts.q.replace(/[^A-Za-z0-9 ._$-]/g, "").trim().slice(0, 42).replace(/^\$/, "") };
  const limit = opts.limit ?? 50, from = opts.offset ?? 0;
  const ownTab = tab === "Launched here" || tab === "Bonding" || tab === "Graduated";
  const ownIds = opts.chain ? OWN_CHAINS.filter((c) => chainName(c) === opts.chain) : OWN_CHAINS;
  const extIds = opts.chain === "Base" ? [8453] : opts.chain === "Robinhood" ? [4663] : opts.chain === "BNB" ? [56] : opts.chain === "Arc" ? [5042] : [8453, 4663, 56, 5042];
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

  let q = db().from("ext_tokens").select("chain_id,address,network,pool,dex,name,symbol,image,price_usd,mcap_usd,fdv_usd,liq_usd,vol_24h,change_24h,change_5m,buys_24h,sells_24h,pool_created,spark").in("chain_id", extIds);
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
    if (data) return fromOwn(data as OwnRow);
    // launched seconds ago: not indexed yet, read it from the chain
    const { coinFromChain } = await import("./chain");
    const row = await coinFromChain(chainId, address as `0x${string}`).catch(() => null);
    return row ? fromOwn(row as unknown as OwnRow) : null;
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
    .map((r) => ({ t: Date.parse(r.t), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: Number(r.v) })).reverse()
    // Each candle opens where the previous one closed, so the chart has no gaps.
    .map((k, i, all) => {
      if (i === 0) return k;
      const o = all[i - 1].c;
      return { ...k, o, h: Math.max(k.h, o), l: Math.min(k.l, o) };
    });
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
  const again = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    const run = () => {
      const n = ++tick.current;
      load().then((d) => { if (alive && n === tick.current) { setData(d); setError(null); } }).catch((e) => alive && setError(String(e?.message || e)));
    };
    run();
    again.current = run;
    const iv = every ? setInterval(run, every) : null;
    return () => { alive = false; if (iv) clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, reload: () => load().then(setData).catch(() => {}) };
}

// ---------------------------------------------------------------- one coin's market (chart + trades)
export type ExtTrade = { id: string; side: "Buy" | "Sell"; usd: string; who: string; at: string };
export async function extTrades(c: LiveCoin): Promise<ExtTrade[]> {
  if (!c.network || !c.pool) return [];
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${c.network}/pools/${c.pool}/trades`, { headers: { accept: "application/json" } }).catch(() => null);
  if (!r || !r.ok) return [];
  const j = await r.json().catch(() => null);
  return (j?.data ?? []).slice(0, 25).map((t: { id: string; attributes: { kind: string; volume_in_usd: string; tx_from_address: string; block_timestamp: string } }) => ({
    id: t.id, side: t.attributes.kind === "sell" ? "Sell" : "Buy", usd: usd(Number(t.attributes.volume_in_usd)), who: short(t.attributes.tx_from_address || ""), at: t.attributes.block_timestamp,
  }));
}

export const IV_SECONDS: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

/** Live chart candles and latest trades for one coin; own coins update instantly on new trades. */
export function useCoinMarket(c: LiveCoin | null | undefined, iv: string, onFresh?: (c: LiveCoin) => void) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [own, setOwn] = useState<LiveTrade[] | null>(null);
  const [ext, setExt] = useState<ExtTrade[] | null>(null);
  const fresh = useRef(onFresh);
  fresh.current = onFresh;
  const key = c ? `${c.id}|${iv}` : "";
  const run = useRef<() => void>(() => {});
  const holdUntil = useRef(0);
  const local = useRef<LiveTrade[]>([]);
  useEffect(() => {
    if (!c) return;
    let alive = true;
    setCandles(null); setOwn(null); setExt(null);
    local.current = []; holdUntil.current = 0;
    const load = async () => {
      if (c.own) {
        const [f, ks, ts] = await Promise.all([getCoin(c.id), ownCandles(c.chainId, c.address, IV_SECONDS[iv] ?? 900), recentTrades(25, { chainId: c.chainId, address: c.address })]);
        if (!alive) return;
        // Right after a trade made here, the database can lag a few seconds: keep the
        // fresher local numbers until it catches up, and never drop a local trade.
        const holding = Date.now() < holdUntil.current;
        if (f && !holding) fresh.current?.(f);
        if (!holding) setCandles(ks);
        const seen = new Set(ts.map((x) => x.id.split("-").slice(0, 2).join("-")));
        local.current = local.current.filter((x) => !seen.has(x.id));
        setOwn([...local.current, ...ts]);
      } else {
        // The chart for other-DEX coins is an embedded DexScreener/GeckoTerminal chart; only trades here.
        const ts = await extTrades(c);
        if (!alive) return;
        setCandles([]); setExt(ts);
      }
    };
    run.current = () => { load().catch(() => {}); };
    run.current();
    const t = setInterval(run.current, c.own ? 20_000 : 60_000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useTradeFeed(() => { if (c?.own) run.current(); }, c?.own ? { chainId: c.chainId, address: c.address } : undefined);

  // A trade made here shows up at once (price, chart, list), before the indexer sees it.
  const cur = useRef(c);
  cur.current = c;
  useEffect(() => {
    let off = () => {};
    import("./chain").then(({ onLocalTrade }) => {
      off = onLocalTrade((t) => {
        const coin = cur.current;
        if (!coin || !coin.own || t.coin.toLowerCase() !== coin.address.toLowerCase() || t.chainId !== coin.chainId) return;
        const target = (coin.startMc ?? 0) * (7500 / 4500);
        const progress = target > (coin.startMc ?? 0) ? Math.max(0, Math.min(100, ((t.mc - (coin.startMc ?? 0)) / (target - (coin.startMc ?? 0))) * 100)) : coin.progress;
        const start = coin.startMc ?? 0;
        fresh.current?.({ ...coin, priceNum: t.price, price: price(t.price), mcNum: t.mc, mc: usd(t.mc), progress, chg: start ? ((t.mc - start) / start) * 100 : coin.chg });
        holdUntil.current = Date.now() + 30_000;
        const row: LiveTrade = { id: `${t.chainId}-${t.hash}`, who: short(t.trader), act: t.isBuy ? "bought" : "sold", amt: usd(t.usdc), tick: coin.tick, up: t.isBuy, ts: new Date(t.at).toISOString(), coin: t.coin.toLowerCase(), chainId: t.chainId, usdcNum: t.usdc, coins: t.coins };
        local.current = [row, ...local.current];
        setOwn((list) => [row, ...(list ?? []).filter((x) => x.id !== row.id)]);
        setCandles((ks) => {
          const sec = IV_SECONDS[iv] ?? 900;
          const bucket = Math.floor(t.at / 1000 / sec) * sec * 1000;
          const list = [...(ks ?? [])];
          const last = list[list.length - 1];
          if (last && last.t === bucket) list[list.length - 1] = { ...last, h: Math.max(last.h, t.price), l: Math.min(last.l, t.price), c: t.price, v: last.v + t.usdc };
          else list.push({ t: bucket, o: last ? last.c : t.price, h: Math.max(t.price, last ? last.c : t.price), l: Math.min(t.price, last ? last.c : t.price), c: t.price, v: t.usdc });
          return list;
        });
      });
    });
    return () => off();
  }, [iv]);
  return { candles, own, ext };
}

/** Text typed into search, made safe for a PostgREST filter. */
export const cleanSearch = (s: string) => s.replace(/[^A-Za-z0-9 ._$-]/g, "").trim().slice(0, 42);

// ---------------------------------------------------------------- sharing, search by address, totals
export function shareCoin(c: LiveCoin) {
  return shareCoinCard(c);
}

/** Finds a coin by contract address on any chain we list. */
export async function findByAddress(address: string): Promise<LiveCoin | null> {
  const a = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) return null;
  const own = await db().from("coin_list").select("*").eq("address", a).limit(1);
  if (own.data && own.data.length) return fromOwn(own.data[0] as OwnRow);
  const ext = await db().from("ext_tokens").select("*").eq("address", a).limit(1);
  if (ext.data && ext.data.length) return fromExt(ext.data[0] as ExtRow);
  return null;
}

/** How many coins the site lists (launched here + other DEXs). */
export async function totalCoins(): Promise<number> {
  const [a, b] = await Promise.all([
    db().from("ext_tokens").select("address", { count: "exact", head: true }),
    db().from("coins").select("address", { count: "exact", head: true }),
  ]);
  return (a.count ?? 0) + (b.count ?? 0);
}

/** Calls back when one of our coins graduates (Supabase Realtime). */
export function useGraduations(cb: (coin: { symbol: string; name: string; chain_id: number; address: string }) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const seen = new Set<string>();
    const ch = db().channel(`grads-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "coins", filter: "phase=eq.2" }, (p) => {
        const n = p.new as { symbol: string; name: string; chain_id: number; address: string; graduated_at: string | null };
        const k = `${n.chain_id}-${n.address}`;
        if (seen.has(k) || !n.graduated_at || Date.now() - Date.parse(n.graduated_at) > 120_000) return;
        seen.add(k);
        ref.current(n);
      })
      .subscribe();
    return () => { db().removeChannel(ch); };
  }, []);
}


/** Coins someone paid to promote, newest first (shown in the Promoted row). */
export async function listPromoted(): Promise<LiveCoin[]> {
  const { data } = await db().from("promotions").select("coin,coin_chain_id,ends_at").gt("ends_at", new Date().toISOString()).order("starts_at", { ascending: false }).limit(30);
  const seen = new Set<string>();
  const want = ((data ?? []) as { coin: string; coin_chain_id: number }[]).filter((p) => { const k = `${p.coin_chain_id}-${p.coin}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
  const out = await Promise.all(want.map((p) => getCoin(`${Number(p.coin_chain_id)}-${p.coin}`).catch(() => null)));
  return out.filter(Boolean) as LiveCoin[];
}
