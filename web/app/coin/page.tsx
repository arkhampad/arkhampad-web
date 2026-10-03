"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { coins } from "@/lib/mock";
import { Avatar, Bar, ChainTag } from "@/components/bits";
import { BurnCard, CandleChart, Intervals, LockCard, SafetyCard, TradePanel, WhyMoving } from "@/components/trade";
import { IBell, ICopy, IGlobe, ILock, IShare, IX } from "@/components/icons";
import { useApp } from "@/components/shell";

const COMMENTS = [
  { who: "mira.eth", c1: "#7C5CFF", c2: "#3A2BFF", t: "2m", held: "Holds 1.2M", txt: "Chart looks clean, dev locked for 24h. Holding to graduation." },
  { who: "kaan", c1: "#FF8A3D", c2: "#FF3D7F", t: "9m", held: "Holds 410K", txt: "AI safety card says low risk, top 10 only 18%. Bought more." },
  { who: "0x9c…11e", c1: "#2BB3FF", c2: "#0066FF", t: "21m", held: "Holds 88K", txt: "Volume picking up again, almost at 7.5K." },
];
const TRADES = [["kaan", "Buy", "$50.00", "12.1M", "12s"], ["0x3f…a91", "Buy", "$25.00", "6.0M", "40s"], ["luna", "Sell", "$18.40", "4.5M", "1m"], ["0x77…f03", "Buy", "$5.00", "1.2M", "2m"], ["mira.eth", "Buy", "$100.00", "24.6M", "3m"]];

function Stat({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="card" style={{ padding: "12px 14px", gap: 4, borderRadius: 14 }}><span className="dim" style={{ fontSize: 12 }}>{k}</span><span className={`mono ${cls || ""}`} style={{ fontWeight: 700, fontSize: 17 }}>{v}</span></div>;
}

function Comments({ tick }: { tick: string }) {
  const { openLogin } = useApp();
  const [more, setMore] = useState(false);
  const list = more ? [...COMMENTS, ...COMMENTS.map((c) => ({ ...c, t: c.t + "+" }))] : COMMENTS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 8px 14px", borderRadius: 14, background: "var(--bg2)", border: "1px dashed #2A2E39" }}>
        <span className="dim" style={{ flex: 1, fontSize: 14 }}>Hold {tick} to join the conversation</span>
        <button type="button" className="btn volt sm" onClick={openLogin}>Buy to comment</button>
      </div>
      {list.map((k, i) => (
        <div key={i} style={{ display: "flex", gap: 12 }}>
          <Avatar name={k.who} c1={k.c1} c2={k.c2} size={36} round />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}><b>{k.who}</b><span className="mono volt" style={{ padding: "2px 7px", borderRadius: 6, background: "rgba(212,255,58,0.10)", fontSize: 11, fontWeight: 600 }}>{k.held}</span><span style={{ color: "var(--faint)" }}>{k.t}</span></span>
            <span style={{ fontSize: 14, lineHeight: 1.5, color: "var(--text2)" }}>{k.txt}</span>
          </div>
        </div>
      ))}
      {!more && <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setMore(true)}>Show more comments</button>}
    </div>
  );
}

function CoinView() {
  const q = useSearchParams();
  const c = coins.find((x) => x.id === q.get("c")) || coins[0];
  const { toast } = useApp();
  const [tab, setTab] = useState("Comments");
  const ca = "0x7a3f9b21c4e8d07a5f61b2c93e40d1a8f2b6c91e";
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <Link href="/" className="dim hide-m" style={{ fontSize: 13 }}>← Discover</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Avatar name={c.name} c1={c.c1} c2={c.c2} size={60} />
        <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: -0.8 }}>{c.name}</h1>
            <span className="mono dim" style={{ fontWeight: 600 }}>{c.tick}</span>
            <span className="pill" style={{ background: "#161922", color: "var(--text2)" }}><ChainTag chain={c.chain} /></span>
            <span className="pill volt" style={{ background: "rgba(212,255,58,0.10)" }}><ILock size={12} color="var(--volt)" w={2.4} />Dev locked</span>
          </div>
          <div className="mono dim" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
            {ca.slice(0, 6)}…{ca.slice(-4)}
            <button type="button" aria-label="Copy contract address" onClick={async () => { try { await navigator.clipboard.writeText(ca); toast("Contract address copied"); } catch { /* blocked */ } }} style={{ width: 28, height: 28, borderRadius: 7, border: 0, background: "#161922", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><ICopy size={13} color="var(--muted)" /></button>
            · by <Link href="/profile/" className="volt">mira.eth</Link> · {c.age} ago
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="icon-btn" aria-label="X" href="#"><IX size={15} /></a><a className="icon-btn" aria-label="Website" href="#"><IGlobe size={16} /></a>
          <button type="button" className="icon-btn" aria-label="Share"><IShare size={16} /></button><button type="button" className="icon-btn" aria-label="Alerts"><IBell size={16} /></button>
        </div>
      </div>
      <div className="grid6">
        <Stat k="Price" v={c.price} /><Stat k="Market cap" v={c.mc} /><Stat k="24h" v={`${c.chg >= 0 ? "+" : ""}${c.chg.toFixed(1)}%`} cls={c.chg >= 0 ? "up" : "down"} />
        <Stat k="Volume 24h" v={c.vol} /><Stat k="Liquidity" v={c.liq} /><Stat k="Holders" v={c.holders} />
      </div>
      <WhyMoving text="Volume is 5x the last hour and 140 new holders joined in 10 minutes. Top 10 wallets hold 18%." />
      <div className="row">
        <div className="main-col">
          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}><span className="mono" style={{ fontWeight: 800, fontSize: 28, letterSpacing: -0.8 }}>{c.price}</span><span className={`mono ${c.chg >= 0 ? "up" : "down"}`} style={{ fontWeight: 700 }}>{c.chg >= 0 ? "+" : ""}{c.chg.toFixed(1)}%</span></div>
              <Intervals />
            </div>
            <CandleChart height={320} seed={c.tick.length + c.chg} />
          </div>
          <div className="panel">
            <div style={{ display: "flex", gap: 4 }}>{["Comments", "Trades", "Holders"].map((t) => <button key={t} type="button" className={`tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
            {tab === "Comments" && <Comments tick={c.tick} />}
            {tab !== "Comments" && (
              <div>{TRADES.map((t, i) => (
                <div key={i} className="mono" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", padding: "10px 0", borderTop: "1px solid #16181F", fontSize: 13, color: "var(--text2)" }}>
                  <span style={{ color: "var(--text)" }}>{t[0]}</span><span className={t[1] === "Buy" ? "up" : "down"} style={{ fontWeight: 700 }}>{t[1]}</span><span>{t[2]}</span><span>{t[3]}</span><span style={{ textAlign: "right", color: "var(--faint)" }}>{t[4]}</span>
                </div>))}</div>
            )}
          </div>
        </div>
        <aside className="side-col" style={{ flexBasis: 360 }}>
          <div className="card" style={{ gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ fontWeight: 700 }}>Graduation</span><span className="mono volt" style={{ fontWeight: 600 }}>$6.9K / $7.5K</span></div>
            <Bar pct={92} /><span className="dim" style={{ fontSize: 12 }}>At $7.5K the coin moves to a locked pool forever.</span>
          </div>
          <div className="hide-m"><TradePanel tick={c.tick} /></div>
          <LockCard /><BurnCard /><SafetyCard />
        </aside>
      </div>
      <div className="show-m" style={{ position: "fixed", left: 0, right: 0, bottom: "calc(74px + var(--safe-bottom))", zIndex: 25, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "10px 16px", background: "rgba(10,11,16,0.97)", borderTop: "1px solid #1B1E25" }}>
        <Link href={`/terminal/?c=${c.id}`} className="btn buy lg">Buy</Link>
        <Link href={`/terminal/?c=${c.id}&side=sell`} className="btn sell lg">Sell</Link>
      </div>
    </div>
  );
}
export default function CoinPage() { return <Suspense fallback={<div className="wrap page" />}><CoinView /></Suspense>; }
