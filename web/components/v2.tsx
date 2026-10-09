"use client";
// v2 (instant pools): every coin opens straight into its locked Uniswap v4 pool.
// Pieces shown on the coin page, Discover cards and Terminal.
import { useEffect, useState } from "react";
import type { LiveCoin } from "@/lib/live";
import { usd } from "@/lib/live";

/** The pool fee schedule set by PadLaunchHook. It is fixed in each chain's hook:
 *  Base (and the first testnets) launched with 30% falling to 2% over five minutes;
 *  every chain opened after that uses 10% falling to 2% over two minutes. */
export const BASE_FEE = 2;
const FIRST_GEN = new Set([8453, 84532, 46630]);
export function launchSchedule(chainId?: number): { start: number; decay: number } {
  return chainId !== undefined && FIRST_GEN.has(chainId) ? { start: 30, decay: 300 } : { start: 10, decay: 120 };
}
/** "10% falling to 2% in two minutes" for a chain. */
export function launchFeeText(chainId?: number): string {
  const s = launchSchedule(chainId);
  return `${s.start}% falling to 2% in ${s.decay === 300 ? "five" : "two"} minutes`;
}

/** Fee in percent at `nowMs` for a coin launched at `createdAt` (ISO). */
export function feeAt(createdAt: string | null | undefined, nowMs = Date.now(), chainId?: number): number {
  const start = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(start)) return BASE_FEE;
  const s = launchSchedule(chainId);
  const t = Math.max(0, (nowMs - start) / 1000);
  if (t >= s.decay) return BASE_FEE;
  return s.start - ((s.start - BASE_FEE) * t) / s.decay;
}

/** Seconds left until the fee is back to 2% (0 when it already is). */
export function feeSecondsLeft(createdAt: string | null | undefined, nowMs = Date.now(), chainId?: number): number {
  const start = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.ceil(launchSchedule(chainId).decay - (nowMs - start) / 1000));
}

/** Re-renders every second while a coin is in its launch window. */
export function useLaunchFee(c: (Pick<LiveCoin, "own" | "createdAt"> & { chainId?: number }) | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  const live = !!c?.own && feeSecondsLeft(c?.createdAt, now, c?.chainId) > 0;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  const fee = c?.own ? feeAt(c.createdAt, now, c.chainId) : null;
  return { fee, left: c?.own ? feeSecondsLeft(c.createdAt, now, c.chainId) : 0, live };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const fmtFee = (f: number) => `${f < 10 ? f.toFixed(1) : f.toFixed(1)}%`;

/** Launch fee countdown: shown only in a coin's first minutes. */
export function LaunchFeeCard({ c }: { c: LiveCoin }) {
  const { fee, left, live } = useLaunchFee(c);
  if (!live || fee === null) return null;
  const decay = launchSchedule(c.chainId).decay;
  const pct = ((decay - left) / decay) * 100;
  // closed by default: one small line; tap to see the countdown and why
  return (
    <details className="card launch-fee lf-mini">
      <summary style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "pointer", listStyle: "none", fontSize: 13 }}>
        <span className="dim">Launch fee active</span>
        <span className="dim" style={{ fontSize: 12 }}>Details ▾</span>
      </summary>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
        <span>Fee now <b className="mono lf-v">{fmtFee(fee)}</b></span>
        <span className="mono dim" style={{ fontSize: 12 }}>drops to 2% in {mmss(left)}</span>
      </div>
      <span className="lf-bar" style={{ marginTop: 8 }}><i style={{ width: `${pct}%` }} /></span>
      <span className="dim" style={{ fontSize: 12, lineHeight: 1.45, marginTop: 6 }}>Bots that buy in the first minutes pay more. After {decay === 300 ? "five" : "two"} minutes every trade pays 2%.</span>
    </details>
  );
}

/** Small fee label for cards and Terminal: the live launch fee, or 2%. */
export function FeeChip({ c }: { c: Pick<LiveCoin, "own" | "createdAt"> & { chainId?: number } }) {
  const { fee, live } = useLaunchFee(c);
  if (fee === null) return null;
  return <span className={`chip-fee mono${live ? " hot" : ""}`} title={live ? "Launch fee, falling to 2%" : "Pool fee"}>fee {live ? fmtFee(fee) : "2%"}</span>;
}

/** Public explorers that list a coin's pool: only on mainnets (testnets aren't listed there). */
function screenLinks(c: LiveCoin): { label: string; href: string }[] {
  const slug = c.chainId === 8453 ? "base" : c.chainId === 4663 ? "robinhood" : c.chainId === 56 ? "bsc" : null;
  if (!slug) return [];
  return [
    { label: "DexScreener", href: `https://dexscreener.com/${slug}/${c.address}` },
    { label: "GMGN", href: `https://gmgn.ai/${slug === "bsc" ? "bsc" : slug}/token/${c.address}` },
  ];
}

/** Where the coin trades: its locked Uniswap pool, the dollars in it and the coin's share of fees. */
export function PoolCard({ c }: { c: LiveCoin }) {
  const links = screenLinks(c);
  const buyback = c.feeMode === 1;
  return (
    <div className="card" style={{ gap: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span className="pill live-pill">Live on Uniswap</span>
        <span className="pill" style={{ background: "var(--raise)", color: "var(--text2)" }}>Liquidity locked forever</span>
        <DexListed c={c} />
      </div>
      <div className="pool-stats">
        <span><i>In pool</i><b className="mono">{c.liq}</b></span>
        <span><i>{buyback ? "Buyback fund" : "Creator earned"}</i><b className="mono">{usd(c.creatorFees ?? 0)}</b></span>
      </div>
      <span className="dim" style={{ fontSize: 12, lineHeight: 1.45 }}>
        Every trade in this pool, from any app, pays the pool fee: 30% of it goes to {buyback ? "buying this coin back and burning it" : "the creator"}. Nobody can remove the liquidity, not even ArkhamPad.
      </span>
      {links.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
          <span className="dim">Also on</span>
          {links.map((l) => <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="btn ghost sm" style={{ height: 30, padding: "0 10px" }}>{l.label}</a>)}
        </div>
      )}
    </div>
  );
}

/** Thin live status bar along the bottom of the site on computers: real numbers, refreshed every minute. */
export function StatusBar() {
  const [s, setS] = useState<{ coins: number | null; vol: number | null; trades: number | null; traders: number | null }>({ coins: null, vol: null, trades: null, traders: null });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [{ platformStats }, { totalCoins }] = await Promise.all([import("@/lib/insights"), import("@/lib/live")]);
        const [st, total] = await Promise.all([platformStats().catch(() => null), totalCoins().catch(() => null)]);
        if (alive) setS({ coins: total, vol: st ? st.volume_24h : null, trades: st ? st.trades_24h : null, traders: st ? st.traders_24h : null });
      } catch { /* keep the last numbers */ }
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const n = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US"));
  return (
    <div className="statusbar hide-m" role="status" aria-label="Platform status">
      <span className="sb-live"><span className="dot" />Live</span>
      <span><b className="mono">{n(s.coins)}</b> coins</span>
      <span><b className="mono">{s.vol === null ? "—" : usd(s.vol)}</b> volume 24h</span>
      <span><b className="mono">{n(s.trades)}</b> trades today</span>
      <span><b className="mono">{n(s.traders)}</b> traders today</span>
      <span style={{ flex: 1 }} />
      <span className="dim">Base · Robinhood Chain</span>
      <span className="sb-ok">All systems normal</span>
    </div>
  );
}

/** "Live on DexScreener ✓": proof the coin is listed, with how fast it happened after launch. */
export function DexListed({ c }: { c: LiveCoin }) {
  if (!c.dexListedAt) return null;
  const secs = c.createdAt ? Math.max(1, Math.round((Date.parse(c.dexListedAt) - Date.parse(c.createdAt)) / 1000)) : null;
  const when = secs === null ? "" : secs < 120 ? ` · ${secs}s after launch` : ` · ${Math.round(secs / 60)} min after launch`;
  return <span className="pill" style={{ background: "rgba(46,189,133,0.14)", color: "var(--up)" }}>Live on DexScreener ✓{when}</span>;
}
