"use client";
// v2 (instant pools): every coin opens straight into its locked Uniswap v4 pool.
// Pieces shown on the coin page, Discover cards and Terminal.
import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { LiveCoin } from "@/lib/live";
import { usd } from "@/lib/live";
import { useApp } from "./shell";
import { useWallet } from "./wallet";
import { CLANKER_SNIPER_SECONDS, TradeError, claimClankerRewards, clankerRewards } from "@/lib/chain";

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

/** Clanker coins: seconds left in Clanker's sniper protection (bots pay up to 80% in a coin's first moments). */
export function sniperSecondsLeft(createdAt: string | null | undefined, nowMs = Date.now()): number {
  const start = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.ceil(CLANKER_SNIPER_SECONDS - (nowMs - start) / 1000));
}
/** Clanker coins pay 1% to the pool on every trade (plus Clanker's 0.2%). */
export const CLANKER_FEE = 1.2;

/** Re-renders every second while a coin is in its launch window. Clanker coins: `sniper` is true
 *  during Clanker's protection (trading on ArkhamPad waits for it), and the fee is then unknown (null). */
export function useLaunchFee(c: (Pick<LiveCoin, "own" | "createdAt"> & { chainId?: number; venue?: string | null }) | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  const clanker = c?.venue === "clanker";
  const left = !c?.own ? 0 : clanker ? sniperSecondsLeft(c.createdAt, now) : feeSecondsLeft(c.createdAt, now, c.chainId);
  const live = !!c?.own && left > 0;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  const fee = !c?.own ? null : clanker ? (live ? null : CLANKER_FEE) : feeAt(c.createdAt, now, c.chainId);
  return { fee, left, live, sniper: clanker && live, clanker };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const fmtFee = (f: number) => `${f < 10 ? f.toFixed(1) : f.toFixed(1)}%`;

/** Launch fee countdown: shown only in a coin's first minutes. */
export function LaunchFeeCard({ c }: { c: LiveCoin }) {
  const { fee, left, live, sniper } = useLaunchFee(c);
  if (sniper) {
    const pct = ((CLANKER_SNIPER_SECONDS - left) / CLANKER_SNIPER_SECONDS) * 100;
    return (
      <div className="card launch-fee" style={{ gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span><b>Sniper protection</b></span>
          <span className="mono dim" style={{ fontSize: 12 }}>trading here opens in {mmss(left)}</span>
        </div>
        <span className="lf-bar"><i style={{ width: `${pct}%` }} /></span>
        <span className="dim" style={{ fontSize: 12, lineHeight: 1.45 }}>Bots that buy in a coin&apos;s first moments pay fees of up to 80%, and half of that goes to the creator. After that every trade pays 1%.</span>
      </div>
    );
  }
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
export function FeeChip({ c }: { c: Pick<LiveCoin, "own" | "createdAt"> & { chainId?: number; venue?: string | null } }) {
  const { fee, live, sniper, clanker } = useLaunchFee(c);
  if (sniper) return <span className="chip-fee mono hot" title="Clanker's sniper protection: bots pay high fees in the first moments">sniper fee</span>;
  if (fee === null) return null;
  if (clanker) return <span className="chip-fee mono" title="Pool fee">fee 1%</span>;
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
  if (c.venue === "clanker") return (
    <div className="card" style={{ gap: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span className="pill live-pill">Live on Uniswap</span>
        <span className="pill" style={{ background: "var(--raise)", color: "var(--text2)" }}>Liquidity locked forever</span>
        <DexListed c={c} />
      </div>
      <div className="pool-stats">
        <span><i>Paired with</i><b className="mono">{c.chainId === 56 ? "BNB" : "ETH"}</b></span>
        <span><i>Creator earned</i><b className="mono">{usd(c.creatorFees ?? 0)}</b></span>
      </div>
      <span className="dim" style={{ fontSize: 12, lineHeight: 1.45 }}>
        Launched on ArkhamPad through Clanker. Every trade in this pool, from any app or bot, pays a 1% fee: half goes to the creator, paid in {c.chainId === 56 ? "BNB" : "ETH"}. Nobody can remove the liquidity, not even ArkhamPad.
      </span>
      {links.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
          <span className="dim">Also on</span>
          {links.map((l) => <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="btn ghost sm" style={{ height: 30, padding: "0 10px" }}>{l.label}</a>)}
        </div>
      )}
    </div>
  );
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
      <span className="dim">Base · BNB Chain · Robinhood Chain</span>
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

/** Clanker coins: the creator's half of every trade's fee, claimable in ETH / BNB. */
export function ClankerRewardsCard({ c }: { c: LiveCoin }) {
  const w = useWallet();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState<{ amount: bigint; usd: number } | null>(null);
  const isCreator = !!w.address && !!c.creator && w.address.toLowerCase() === c.creator.toLowerCase();
  const sym = c.chainId === 56 ? "BNB" : "ETH";
  useEffect(() => {
    if (!isCreator || !w.address) { setNow(null); return; }
    let alive = true;
    const load = () => clankerRewards(c.chainId, w.address as Address).then((r) => { if (alive) setNow(r); });
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [isCreator, w.address, c.chainId]);
  const claim = async () => {
    if (!w.signer) { w.login(); return; }
    setBusy(true);
    try {
      const got = await claimClankerRewards(c.chainId, w.signer);
      toast(`${(Number(got) / 1e18).toFixed(6)} ${c.chainId === 56 ? "WBNB" : "WETH"} sent to your wallet`);
      setNow({ amount: 0n, usd: 0 });
      await w.refresh();
    } catch (e) { toast(e instanceof TradeError ? e.message : "Couldn't claim right now. Please try again."); }
    finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700 }}>Creator earnings</span>
        <span className="dim mono" style={{ fontSize: 12 }}>by {c.creator ? `${c.creator.slice(0, 6)}…${c.creator.slice(-4)}` : "—"}</span>
      </div>
      <span className="dim" style={{ fontSize: 13, lineHeight: 1.5 }}>The creator earns half of the 1% fee on every trade, in any app, paid in {sym}.</span>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}><span className="dim">Earned so far</span><b className="mono">{usd(c.creatorFees ?? 0, 2)}</b></div>
      {isCreator && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}><span className="dim">Ready to claim</span><b className="mono">{now === null ? "…" : `${usd(now.usd, 2)}`}</b></div>
          <button type="button" className="btn volt" disabled={busy || !now || now.amount === 0n} onClick={claim}>{busy ? "Claiming…" : `Claim ${sym} rewards`}</button>
          <span style={{ fontSize: 11, color: "var(--faint)" }}>Rewards go to your wallet as {c.chainId === 56 ? "WBNB" : "WETH"}. The network fee is paid from your cash.</span>
        </>
      )}
    </div>
  );
}
