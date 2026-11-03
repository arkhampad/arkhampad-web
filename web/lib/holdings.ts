"use client";
// Your coins and their value, fast: the last known list shows instantly (saved on this device), the indexer's
// list replaces it in one round trip, then every balance is confirmed on-chain in the background.
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { fetchHoldings, fetchTokensByAddress, usePoll, type EToken } from "@/lib/ely";
import { chainToken, ely, recentTokens, tokenBalance } from "@/lib/elytrade";
import { parseAbi } from "viem";

export type Holding = { t: EToken; amount: number; value: number };

const mem = new Map<string, Holding[]>();
const key = (me: string) => `ap_hold_${me}`;

export function lastAddress(): string | null {
  try { return localStorage.getItem("ap_last_me"); } catch { return null; }
}
export function rememberAddress(me: string | null) {
  if (!me) return;
  try { localStorage.setItem("ap_last_me", me.toLowerCase()); } catch {}
}

export function cachedHoldings(me: string | null): Holding[] | undefined {
  if (!me) return undefined;
  if (mem.has(me)) return mem.get(me);
  try {
    const v = localStorage.getItem(key(me));
    if (v) { const list = JSON.parse(v) as Holding[]; mem.set(me, list); return list; }
  } catch {}
  return undefined;
}
function save(me: string, list: Holding[]) {
  mem.set(me, list);
  try { localStorage.setItem(key(me), JSON.stringify(list.slice(0, 60))); } catch {}
  try { window.dispatchEvent(new CustomEvent("ap:holdings", { detail: me })); } catch {}
}

/*
 * A trade the network has taken but no node has in a block yet (20-40 s on Elysium). Until the chain shows
 * the new balances, every screen shows the balances after the trade, for HYPE and for the coin together:
 * otherwise one side updates before the other and the total jumps up or down for a few seconds.
 */
type Pend = { hypeFrom: bigint; hypeTo: bigint | null; coins: Map<string, { t: EToken; from: bigint; to: bigint }>; until: number };
const pend = new Map<string, Pend>();
export function pendingTrade(me: string, t: EToken, x: { hypeFrom: bigint | null; hypeTo: bigint | null; tokFrom: bigint; tokTo: bigint }) {
  const k = me.toLowerCase();
  const old = pend.get(k);
  const p: Pend = old && Date.now() < old.until ? old : { hypeFrom: x.hypeFrom ?? 0n, hypeTo: null, coins: new Map(), until: 0 };
  if (x.hypeTo != null) p.hypeTo = x.hypeTo;
  const a = t.address.toLowerCase();
  const prev = p.coins.get(a);
  p.coins.set(a, { t, from: prev ? prev.from : x.tokFrom, to: x.tokTo });
  p.until = Date.now() + 90_000;
  pend.set(k, p);
  // update the list on screen now
  const list = cachedHoldings(k) ?? [];
  const dec = t.decimals ?? 18;
  const amount = Number(x.tokTo) / 10 ** dec;
  const rest = list.filter((h) => h.t.address.toLowerCase() !== a);
  const next = amount > 0 ? [...rest, { t, amount, value: amount * (t.price_hype ?? 0) }] : rest;
  save(k, next.sort((m, n) => n.value - m.value));
}
/** The HYPE to show: the balance after a trade still on its way, or the chain's number once it has moved. */
export function shownHype(me: string | null | undefined, chain: bigint | null | undefined): bigint | null | undefined {
  if (!me) return chain;
  const p = pend.get(me.toLowerCase());
  if (!p || p.hypeTo == null || Date.now() > p.until) return chain;
  // the chain has it once its number is nearer the balance after the trade than the one before
  const d = (x: bigint, y: bigint) => (x > y ? x - y : y - x);
  if (chain != null && chain !== p.hypeFrom && d(chain, p.hypeTo) <= d(chain, p.hypeFrom)) { p.hypeTo = null; return chain; }
  return p.hypeTo;
}
function pendingCoin(me: string, a: string, chain: bigint | null): bigint | null {
  const p = pend.get(me);
  const c = p?.coins.get(a);
  if (!p || !c || Date.now() > p.until) return chain;
  const d = (x: bigint, y: bigint) => (x > y ? x - y : y - x);
  if (chain != null && chain !== c.from && d(chain, c.to) <= d(chain, c.from)) { p.coins.delete(a); return chain; }
  return c.to;
}

async function load(me: string, onFirst: (l: Holding[]) => void, full: boolean): Promise<Holding[]> {
  const rows = await fetchHoldings(me).catch(() => []);
  const recent = recentTokens().map((a) => a.toLowerCase());
  const pc = pend.get(me)?.coins;
  const addrs = [...new Set([...rows.map((r) => r.token.toLowerCase()), ...recent, ...(pc ? [...pc.keys()] : [])])];
  const toks = await fetchTokensByAddress(addrs).catch(() => [] as EToken[]);
  const byAddr = new Map(toks.map((t) => [t.address.toLowerCase(), t]));
  if (pc) for (const [a, c] of pc) if (!byAddr.has(a)) byAddr.set(a, c.t);
  const build = (bal: Map<string, bigint>) =>
    addrs
      .map((a) => {
        const t = byAddr.get(a) ?? ({ address: a, name: "", symbol: "?", decimals: 18 } as EToken);
        const raw = pendingCoin(me, a, bal.get(a) ?? null) ?? BigInt(rows.find((r) => r.token.toLowerCase() === a)?.amount ?? "0");
        const amount = Number(raw) / 10 ** (t.decimals ?? 18);
        return { t, amount, value: amount * (t.price_hype ?? 0) };
      })
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.value - a.value);
  // first paint: the indexer's numbers, no chain reads
  onFirst(build(new Map()));
  // then the live chain for every coin (in the background, the list is already on screen), so a balance
  // that changed outside ArkhamPad or that the indexer hasn't caught up with is never missing or stale
  // (every coin on the first load, after a trade and once a minute; in between only the ones just traded)
  const check = full ? addrs.slice(0, 60) : addrs.filter((a) => recent.includes(a) || !byAddr.get(a)?.name || pc?.has(a));
  const live = await Promise.all(
    check.map(async (a) => {
      if (!byAddr.get(a)?.name) { const c = await chainToken(a).catch(() => null); if (c) byAddr.set(a, { ...(byAddr.get(a) ?? {}), ...c } as EToken); }
      return [a, await tokenBalance(a as Address, me as Address).catch(() => null)] as const;
    }),
  );
  return build(new Map(live.filter((x): x is readonly [string, bigint] => x[1] != null)));
}

/** Your coins: instant from cache, refreshed every 15 s and right after any trade. */
export function useHoldings(me: string | null): Holding[] | undefined {
  const [v, setV] = useState<Holding[] | undefined>(() => cachedHoldings(me));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    setV(cachedHoldings(me));
    if (!me) return;
    let t: ReturnType<typeof setTimeout>;
    let n = 0;
    let force = true;
    const run = async () => {
      const full = force || n % 4 === 0;
      force = false;
      n++;
      try {
        const list = await load(me, (first) => { if (alive.current && first.length) setV((old) => (old && old.length ? old : first)); }, full);
        if (alive.current) { setV(list); save(me, list); }
      } catch {}
      if (alive.current) t = setTimeout(tick, 15_000);
    };
    const tick = () => (document.visibilityState === "visible" ? run() : (t = setTimeout(tick, 2000)));
    const now = () => { clearTimeout(t); force = true; run(); };
    const other = (e: Event) => { if ((e as CustomEvent).detail === me && alive.current) setV(cachedHoldings(me)); };
    window.addEventListener("ap:balance", now);
    window.addEventListener("ap:holdings", other);
    const vis = () => { if (document.visibilityState === "visible") now(); };
    document.addEventListener("visibilitychange", vis);
    run();
    return () => { alive.current = false; clearTimeout(t); window.removeEventListener("ap:balance", now); window.removeEventListener("ap:holdings", other); document.removeEventListener("visibilitychange", vis); };
  }, [me]);
  return v;
}

export const holdingsHype = (list?: Holding[]) => (list ?? []).reduce((s, h) => s + h.value, 0);

/*
 * USDC on Elysium itself: coins paired with USDC (Ascend's pools and others) pay out USDC when sold. Its
 * address is the quote of any USDC pool (or NEXT_PUBLIC_ELY_USDC); the value counts in every total.
 */
let usdcAddr: Promise<{ a: Address; dec: number } | null> | null = null;
function elyUsdcToken() {
  if (usdcAddr) return usdcAddr;
  usdcAddr = (async () => {
    const env = (process.env.NEXT_PUBLIC_ELY_USDC || "").toLowerCase();
    let a = /^0x[0-9a-f]{40}$/.test(env) ? env : "";
    if (!a) { try { a = localStorage.getItem("ap_ely_usdc") || ""; } catch {} }
    if (!a) {
      const r = await fetch(`/api/ely-rest?p=${encodeURIComponent("ely_tokens?select=whype&venue=eq.cl&whype=not.is.null&limit=1")}&ttl=600`).then((x) => (x.ok ? x.json() : [])).catch(() => []);
      a = String(r?.[0]?.whype || "").toLowerCase();
    }
    if (!/^0x[0-9a-f]{40}$/.test(a)) { usdcAddr = null; return null; }
    const ERC = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);
    const [dec, sym] = await Promise.all([
      ely().readContract({ address: a as Address, abi: ERC, functionName: "decimals" }).then(Number).catch(() => 6),
      ely().readContract({ address: a as Address, abi: ERC, functionName: "symbol" }).then(String).catch(() => "USDC"),
    ]);
    if (!/usd/i.test(sym)) { usdcAddr = null; return null; }
    try { localStorage.setItem("ap_ely_usdc", a); } catch {}
    return { a: a as Address, dec };
  })();
  return usdcAddr;
}
const usdcKey = (me: string) => `ap_elyusdc_${me}`;
/** Dollars of USDC this address holds on Elysium (last known value first). */
export function useElyUsdc(me: string | null): number {
  const v = usePoll(async () => {
    if (!me) return null;
    const u = await elyUsdcToken();
    if (!u) return 0;
    const raw = await tokenBalance(u.a, me as Address).catch(() => null);
    if (raw == null) return null;
    const n = Number(raw) / 10 ** u.dec;
    try { localStorage.setItem(usdcKey(me), String(n)); } catch {}
    return n;
  }, 20_000, [me]);
  if (v != null) return v;
  if (!me) return 0;
  try { return Number(localStorage.getItem(usdcKey(me)) || 0) || 0; } catch { return 0; }
}
