"use client";
import { useMemo, useState } from "react";
import { coins } from "@/lib/mock";
import { Avatar } from "@/components/bits";
import { ISpark } from "@/components/icons";

function Kpi({ k, v, d, col = "var(--up)" }: { k: string; v: string; d: string; col?: string }) {
  return <div className="card" style={{ borderRadius: 22, padding: 20, gap: 8 }}><span className="dim" style={{ fontSize: 13 }}>{k}</span><span className="mono" style={{ fontWeight: 800, fontSize: "clamp(22px, 3vw, 34px)", letterSpacing: -1 }}>{v}</span><span className="mono" style={{ fontWeight: 600, fontSize: 12, color: col }}>{d}</span></div>;
}
function Box({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return <div className="panel" style={{ borderRadius: 22, padding: 20, gap: 14 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}><span style={{ fontWeight: 800, fontSize: 16 }}>{title}</span>{right}</div>{children}</div>;
}
const Legend = ({ items }: { items: [string, string][] }) => <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--muted)" }}>{items.map(([t, c]) => <span key={t} style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{t}</span>)}</div>;

function rand(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
function Stacked() {
  const bars = useMemo(() => { const r = rand(5); return Array.from({ length: 30 }, (_, i) => [(30 + r() * 60) * (0.6 + i / 30), (20 + r() * 50) * (0.6 + i / 30)]); }, []);
  const mx = Math.max(...bars.map((b) => b[0] + b[1])), W = 900, H = 260, bw = W / 30;
  return <svg width="100%" height={260} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Daily volume by chain">{[20, 80, 140, 200].map((y) => <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="var(--line)" />)}{bars.map(([r, b], i) => { const hr = (r / mx) * (H - 20), hb = (b / mx) * (H - 20), x = i * bw + bw * 0.15; return <g key={i}><rect x={x} y={H - hr - hb} width={bw * 0.7} height={hb} rx="3" fill="#5B8CFF" /><rect x={x} y={H - hr} width={bw * 0.7} height={hr} rx="3" fill="#CCFF4D" /></g>; })}</svg>;
}
function DayBars({ seed, col, hi }: { seed: number; col: string; hi: string }) {
  const vals = useMemo(() => { const r = rand(seed); return Array.from({ length: 14 }, (_, i) => 20 + r() * 40 + i * 2); }, [seed]);
  const m = Math.max(...vals), W = 600, H = 200, bw = W / 14;
  return <svg width="100%" height={200} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Daily chart">{vals.map((v, i) => { const h = (v / m) * (H - 30); return <rect key={i} x={i * bw + bw * 0.18} y={H - 20 - h} width={bw * 0.64} height={h} rx="5" fill={i === 13 ? hi : col} />; })}<text x="0" y={H - 4} fontFamily="Geist Mono, monospace" fontSize="11" fill="#7E8592">14 days ago</text><text x={W} y={H - 4} textAnchor="end" fontFamily="Geist Mono, monospace" fontSize="11" fill="#D4FF3A">Today</text></svg>;
}
function Donut() {
  const arc = (p0: number, p1: number) => { const r = 70, cx = 90, cy = 90, a0 = 2 * Math.PI * p0 - Math.PI / 2, a1 = 2 * Math.PI * p1 - Math.PI / 2; return `M${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${p1 - p0 > 0.5 ? 1 : 0} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)}`; };
  return <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label="Volume by chain"><path d={arc(0, 0.58)} stroke="#CCFF4D" strokeWidth="22" fill="none" /><path d={arc(0.595, 0.985)} stroke="#5B8CFF" strokeWidth="22" fill="none" /><text x="90" y="86" textAnchor="middle" fontFamily="Geist Mono, monospace" fontSize="22" fontWeight="700" fill="#F2F3F5">$18.4M</text><text x="90" y="108" textAnchor="middle" fontSize="12" fill="#8A909C">24h volume</text></svg>;
}
function Rec({ k, v, s }: { k: string; v: string; s: string }) {
  return <div className="card" style={{ background: "linear-gradient(160deg, #151826, #0D0E13)", borderColor: "var(--line2)", gap: 6 }}><span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{k}</span><span className="mono" style={{ fontWeight: 800, fontSize: 22, letterSpacing: -0.6 }}>{v}</span><span className="muted" style={{ fontSize: 12 }}>{s}</span></div>;
}

export default function Analytics() {
  const [range, setRange] = useState("7d");
  return (
    <div className="wrap page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><h1 className="h-title">Analytics</h1><p className="h-sub">Everything happening on ArkhamPad, live.</p></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div className="hscroll" style={{ gap: 6 }}>{["24h", "7d", "30d", "All time"].map((t) => <button key={t} type="button" className={`chip sm${range === t ? " on" : ""}`} onClick={() => setRange(t)}>{t}</button>)}</div>
          <a href="#" className="btn white sm" style={{ borderRadius: 999 }}>Verify on-chain ↗</a>
        </div>
      </div>
      <div className="ai-note" style={{ padding: "18px 20px", borderRadius: 20, fontSize: 15 }}><ISpark size={18} color="var(--volt-ink)" /><span><b>Today in 30 seconds:</b> Volume is up 24% vs yesterday, driven by animal coins on Base. Robinhood had more launches, Base had more graduations. The average time to graduate fell to 41 minutes.</span></div>
      <div className="grid4">
        <Kpi k="Volume" v="$18.4M" d="+24.1% vs prev" /><Kpi k="Coins launched" v="1,920" d="+12.3% vs prev" /><Kpi k="Graduated" v="412" d="21.4% graduation rate" col="var(--volt)" /><Kpi k="Traders" v="38.2K" d="+8.7% vs prev" />
        <Kpi k="Creator earnings" v="$642K" d="+31.0% vs prev" /><Kpi k="Bought back & burned" v="$88.4K" d="from Buyback mode coins" col="var(--burn)" /><Kpi k="Unique creators" v="14.6K" d="lifetime total" col="var(--dim)" /><Kpi k="Holders" v="211K" d="lifetime total" col="var(--dim)" />
      </div>
      <div className="row" style={{ gap: 16 }}>
        <div style={{ flex: "999 1 600px", minWidth: 0 }}><Box title="Daily volume" right={<Legend items={[["Robinhood", "#CCFF4D"], ["Base", "#5B8CFF"]]} />}><Stacked /></Box></div>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}><Box title="Volume by chain"><div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}><Donut />{[["Robinhood", "#CCFF4D", "$10.7M", "58%"], ["Base", "#5B8CFF", "$7.7M", "42%"]].map(([t, c, v, p]) => <div key={t} style={{ width: "100%", display: "flex", justifyContent: "space-between", fontSize: 14 }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{t}</span><span className="mono" style={{ fontWeight: 700 }}>{v} <span className="dim" style={{ fontWeight: 500 }}>{p}</span></span></div>)}</div></Box></div>
      </div>
      <div className="grid2">
        <Box title="Creator earnings · daily" right={<span className="mono" style={{ fontWeight: 700 }}>$642K</span>}><DayBars seed={11} col="#3E5A1A" hi="#D4FF3A" /></Box>
        <Box title="Coins launched · daily" right={<span className="mono" style={{ fontWeight: 700 }}>1,920</span>}><DayBars seed={23} col="#2A3550" hi="#5B8CFF" /></Box>
      </div>
      <div className="grid4"><Rec k="Biggest buy today" v="$4,200" s="kaan bought ORBD" /><Rec k="Fastest graduation" v="3m 12s" s="Glitch on Base" /><Rec k="Most holders" v="8,410" s="Neon Whale" /><Rec k="Best 24h" v="+640%" s="Moonfrog" /></div>
      <div className="grid2">
        <Box title="Top gainers 24h">{[...coins].sort((a, b) => b.chg - a.chg).slice(0, 4).map((c) => <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name={c.name} c1={c.c1} c2={c.c2} size={34} /><span style={{ flex: 1, display: "flex", flexDirection: "column" }}><b style={{ fontSize: 14 }}>{c.name}</b><span className="mono dim" style={{ fontSize: 11 }}>{c.tick} · {c.mc}</span></span><span className="mono up" style={{ fontWeight: 700 }}>+{c.chg.toFixed(1)}%</span></div>)}</Box>
        <Box title="Fastest to graduate">{[["Glitch", "GLCH", "3m 12s", "#2BB3FF", "#0066FF"], ["Banana Bot", "BBOT", "5m 40s", "#F5C542", "#FF7A00"], ["Paper Hands", "PPRH", "8m 05s", "#E8559A", "#8A2BE2"]].map(([n, t, s, c1, c2]) => <div key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name={n} c1={c1} c2={c2} size={34} /><span style={{ flex: 1, display: "flex", flexDirection: "column" }}><b style={{ fontSize: 14 }}>{n}</b><span className="mono dim" style={{ fontSize: 11 }}>{t}</span></span><span className="mono volt" style={{ fontWeight: 700 }}>{s}</span></div>)}</Box>
      </div>
    </div>
  );
}
