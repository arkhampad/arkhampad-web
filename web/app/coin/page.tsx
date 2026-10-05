"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getCoin, useCoinMarket, shareCoin, prepareCard, usd, short, ago, listCoins, type LiveCoin } from "@/lib/live";
import { Avatar, Bar, ChainTag } from "@/components/bits";
import { Intervals } from "@/components/trade";
import { TradePanel } from "@/components/tradepanel";
import { AboutCard, CreatorCard, HoldersCard, PromoteButton } from "@/components/cointools";
import { OrdersList } from "@/components/orders";
import { Comments } from "@/components/community";
import { LockCard, SafetyCard } from "@/components/safety";
import dynamic from "next/dynamic";
const TvChart = dynamic(() => import("@/components/tvchart"), { ssr: false, loading: () => <div className="skel" style={{ height: 380, borderRadius: 12 }} /> });
const ExtChart = dynamic(() => import("@/components/extchart"), { ssr: false, loading: () => <div className="skel" style={{ height: 420, borderRadius: 12 }} /> });
import { ICopy, IShare } from "@/components/icons";
import { useApp } from "@/components/shell";


function Stat({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="card" style={{ padding: "12px 14px", gap: 4, borderRadius: 14 }}><span className="dim" style={{ fontSize: 12 }}>{k}</span><span className={`mono ${cls || ""}`} style={{ fontWeight: 700, fontSize: 17 }}>{v}</span></div>;
}

function CoinView() {
  const q = useSearchParams();
  const id = q.get("c") || "";
  const { toast } = useApp();
  const [c, setC] = useState<LiveCoin | null | undefined>(undefined);
  const [iv, setIv] = useState("15m");
  // young coins have few trades: start on 1-minute candles so the chart isn't empty
  const youngId = useRef("");
  useEffect(() => { if (c) prepareCard(c); }, [c?.id, c?.mc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!c || youngId.current === c.id) return;
    youngId.current = c.id;
    const age = c.createdAt ? Date.now() - Date.parse(c.createdAt) : Infinity;
    setIv(c.own && age < 6 * 3600_000 ? "1m" : "15m");
  }, [c]);
  const [sheet, setSheet] = useState<null | "buy" | "sell">(null);
  const m = useCoinMarket(c, iv, setC);
  const candles = m.candles, own = m.own, ext = m.ext;

  // Always start at the top of the page when a coin opens.
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [id]);

  // Unknown or old links open the top trending coin.
  useEffect(() => {
    let alive = true;
    (async () => {
      let coin = await getCoin(id).catch(() => null);
      if (!coin && !/^\d+-0x/.test(id)) coin = (await listCoins("Trending", { limit: 1 }).catch(() => []))[0] ?? null;
      if (alive) setC(coin);
    })();
    return () => { alive = false; };
  }, [id]);

  if (c === undefined) return <div className="wrap page"><div className="skel" style={{ height: 80, borderRadius: 16 }} /><div className="skel" style={{ height: 380, borderRadius: 16 }} /></div>;
  if (c === null) return (
    <div className="wrap page" style={{ alignItems: "center", textAlign: "center", gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 26 }}>Coin not found</h1>
      <span className="dim">It may be too new or not listed yet.</span>
      <Link href="/" className="btn volt">Back to Discover</Link>
    </div>
  );

  const up = c.chg >= 0;
  const target = (c.startMc ?? 0) * (7500 / 4500);
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <Link href="/" className="dim hide-m" style={{ fontSize: 13 }}>← Discover</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span className="coin-av"><Avatar name={c.name} c1={c.c1} c2={c.c2} size={60} img={c.image} /></span>
        <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 className="coin-h1" style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: -0.8, overflowWrap: "anywhere" }}>{c.name}</h1>
            <span className="mono dim" style={{ fontWeight: 600 }}>{c.tick}</span>
            <span className="pill" style={{ background: "var(--raise)", color: "var(--text2)" }}><ChainTag chain={c.chain} /></span>
            {c.own ? <span className="pill" style={{ background: "rgba(212,255,58,0.12)", color: "var(--volt-ink)" }}>Testnet</span> : <span className="pill" style={{ background: "var(--raise)", color: "var(--muted)" }}>{c.dex ? c.dex.replace(/[-_]/g, " ") : "Other DEX"}</span>}
          </div>
          <div className="mono dim" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
            {short(c.address)}
            <button type="button" aria-label="Copy contract address" onClick={async () => { try { await navigator.clipboard.writeText(c.address); toast("Contract address copied"); } catch { /* blocked */ } }} style={{ width: 28, height: 28, borderRadius: 7, border: 0, background: "var(--raise)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><ICopy size={13} color="var(--muted)" /></button>
            {c.own && c.creator ? <>· by {short(c.creator)}</> : null} · {c.age} old
          </div>
        </div>
        <span style={{ display: "flex", gap: 8 }}><button type="button" className="btn ghost sm" aria-label="Share on X" onClick={() => shareCoin(c)}><IShare size={15} />Share</button><PromoteButton c={c} /></span>
      </div>

      <div className="grid6 hide-m">
        <Stat k="Price" v={c.price} /><Stat k="Market cap" v={c.mc} /><Stat k="24h" v={`${up ? "+" : ""}${c.chg.toFixed(1)}%`} cls={up ? "up" : "down"} />
        <Stat k="Volume 24h" v={c.vol} /><Stat k={c.own ? "In curve" : "Liquidity"} v={c.liq} /><Stat k={c.own ? "Buyers" : "Trades 24h"} v={c.own ? c.holders : c.trades} />
      </div>

      <div className="row">
        <div className="main-col">
          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}><span className="mono" style={{ fontWeight: 800, fontSize: 28, letterSpacing: -0.8 }}>{c.price}</span><span className={`mono ${up ? "up" : "down"}`} style={{ fontWeight: 700 }}>{up ? "+" : ""}{c.chg.toFixed(1)}%</span></div>
              {c.own && <Intervals value={iv} onChange={setIv} />}
            </div>
            {c.own ? <TvChart candles={candles} supply={1e9} empty="No trades yet for a chart." seriesKey={`${c.id}|${iv}`} /> : <ExtChart network={c.network} pool={c.pool} />}
          </div>
          <div className="grid6 show-m stats-m">
            <Stat k="Price" v={c.price} /><Stat k="Market cap" v={c.mc} /><Stat k="24h" v={`${up ? "+" : ""}${c.chg.toFixed(1)}%`} cls={up ? "up" : "down"} />
            <Stat k="Volume 24h" v={c.vol} /><Stat k={c.own ? "In curve" : "Liquidity"} v={c.liq} /><Stat k={c.own ? "Buyers" : "Trades 24h"} v={c.own ? c.holders : c.trades} />
          </div>
          {c.own && <SafetyCard c={c} />}
          {c.own && <LockCard c={c} />}
          {c.own && <Comments c={c} />}
          <div className="panel">
            <span style={{ fontWeight: 700 }}>Latest trades{c.own ? " · testnet" : ""}</span>
            {c.own ? (
              own === null ? <div className="skel" style={{ height: 120, borderRadius: 12 }} /> : own.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No trades yet.</span> :
                own.map((t) => (
                  <div key={t.id} className="mono" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", padding: "10px 0", borderTop: "1px solid var(--row)", fontSize: 13, color: "var(--text2)" }}>
                    <span style={{ color: "var(--text)" }}>{t.who}</span><span className={t.up ? "up" : "down"} style={{ fontWeight: 700 }}>{t.up ? "Buy" : "Sell"}</span><span>{t.amt}</span><span style={{ textAlign: "right", color: "var(--faint)" }}>{ago(t.ts)}</span>
                  </div>))
            ) : (
              ext === null ? <div className="skel" style={{ height: 120, borderRadius: 12 }} /> : ext.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>Trades will show here.</span> :
                ext.map((t) => (
                  <div key={t.id} className="mono" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", padding: "10px 0", borderTop: "1px solid var(--row)", fontSize: 13, color: "var(--text2)" }}>
                    <span style={{ color: "var(--text)" }}>{t.who}</span><span className={t.side === "Buy" ? "up" : "down"} style={{ fontWeight: 700 }}>{t.side}</span><span>{t.usd}</span><span style={{ textAlign: "right", color: "var(--faint)" }}>{ago(t.at)}</span>
                  </div>))
            )}
          </div>
        </div>
        <aside className="side-col" style={{ flexBasis: 360 }}>
          {c.own && <OrdersList coin={c.address} chainId={c.chainId} title="Your open orders" />}
          <AboutCard c={c} />
          {c.own && <CreatorCard c={c} onImage={(url) => setC({ ...c, image: url })} />}
          {c.own && <HoldersCard c={c} />}
          {c.own && (
            <div className="card" style={{ gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ fontWeight: 700 }}>Graduation</span><span className="mono volt" style={{ fontWeight: 600 }}>{c.phase === 2 ? "Graduated" : `${usd(c.mcNum)} / ${usd(target)}`}</span></div>
              <Bar pct={c.progress} /><span className="dim" style={{ fontSize: 12 }}>At graduation the coin moves to a locked pool forever.</span>
            </div>
          )}
          {!c.own && (
            <div className="card" style={{ gap: 6 }}>
              <span style={{ fontWeight: 700 }}>Trading opens on mainnet</span>
              <span className="dim" style={{ fontSize: 13, lineHeight: 1.5 }}>This coin trades on other DEXs. On mainnet you can buy and sell it here with USDC in one tap, at the best price across DEXs (1% fee).</span>
            </div>
          )}
          <div className="hide-m"><TradePanel coin={c} onShare={() => shareCoin(c)} /></div>
        </aside>
      </div>
      <div className="show-m" style={{ position: "fixed", left: 0, right: 0, bottom: "calc(74px + var(--safe-bottom))", zIndex: 25, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "10px 16px", background: "var(--bar-bg)", borderTop: "1px solid var(--line)" }}>
        <button type="button" className="btn buy lg" onClick={() => setSheet("buy")}>Buy</button>
        <button type="button" className="btn sell lg" onClick={() => setSheet("sell")}>Sell</button>
      </div>
      {sheet && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={`Trade ${c.tick}`} style={{ padding: 12 }}>
            <TradePanel coin={c} initialSide={sheet} onShare={() => shareCoin(c)} />
            <button type="button" className="btn ghost" onClick={() => setSheet(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
export default function CoinPage() { return <Suspense fallback={<div className="wrap page" />}><CoinView /></Suspense>; }
