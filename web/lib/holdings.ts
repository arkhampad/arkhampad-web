"use client";
// Your coins and their value, fast: the last known list shows instantly (saved on this device), the indexer's
// list replaces it in one round trip, then every balance is confirmed on-chain in the background.
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { fetchHoldings, fetchTokensByAddress, type EToken } from "@/lib/ely";
import { chainToken, recentTokens, tokenBalance } from "@/lib/elytrade";

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

async function load(me: string, onFirst: (l: Holding[]) => void): Promise<Holding[]> {
  const rows = await fetchHoldings(me).catch(() => []);
  const recent = recentTokens().map((a) => a.toLowerCase());
  const addrs = [...new Set([...rows.map((r) => r.token.toLowerCase()), ...recent])];
  const toks = await fetchTokensByAddress(addrs).catch(() => [] as EToken[]);
  const byAddr = new Map(toks.map((t) => [t.address.toLowerCase(), t]));
  const build = (bal: Map<string, bigint>) =>
    addrs
      .map((a) => {
        const t = byAddr.get(a) ?? ({ address: a, name: "", symbol: "?", decimals: 18 } as EToken);
        const raw = bal.get(a) ?? BigInt(rows.find((r) => r.token.toLowerCase() === a)?.amount ?? "0");
        const amount = Number(raw) / 10 ** (t.decimals ?? 18);
        return { t, amount, value: amount * (t.price_hype ?? 0) };
      })
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.value - a.value);
  // first paint: the indexer's numbers, no chain reads
  onFirst(build(new Map()));
  // then the live chain for every coin (in the background, the list is already on screen), so a balance
  // that changed outside ArkhamPad or that the indexer hasn't caught up with is never missing or stale
  const check = addrs.slice(0, 60);
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
    const run = async () => {
      try {
        const list = await load(me, (first) => { if (alive.current && first.length) setV((old) => (old && old.length ? old : first)); });
        if (alive.current) { setV(list); save(me, list); }
      } catch {}
      if (alive.current) t = setTimeout(tick, 15_000);
    };
    const tick = () => (document.visibilityState === "visible" ? run() : (t = setTimeout(tick, 2000)));
    const now = () => { clearTimeout(t); run(); };
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
