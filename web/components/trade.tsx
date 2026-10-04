"use client";
import { useMemo, useState } from "react";
import { IAlert, IBell, ICheck, IFire, ILock, IShare, IShield, ISpark } from "./icons";
import { useApp } from "./shell";

export function CandleChart({ height = 340, seed = 3 }: { height?: number; seed?: number }) {
  const W = 880, H = 340, n = 64, cw = W / n;
  const data = useMemo(() => {
    let s = seed * 9301 + 49297; const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    let o = 50; const cs: [number, number, number, number][] = [];
    for (let i = 0; i < n; i++) { const c = o + (r() - 0.46) * 8.6; cs.push([o, c, Math.max(o, c) + r() * 2.7 + 0.3, Math.min(o, c) - r() * 2.7 - 0.3]); o = c; }
    const lo = Math.min(...cs.map((x) => x[3])), hi = Math.max(...cs.map((x) => x[2]));
    const Y = (v: number) => H - 16 - ((v - lo) / (hi - lo)) * (H - 32);
    const vol = cs.map(() => 4 + r() * 30);
    return { cs, Y, vol };
  }, [seed]);
  const last = data.Y(data.cs[n - 1][1]);
  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Price chart">
        {[40, 100, 160, 220, 280].map((y) => <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="#1A1D25" />)}
        {data.cs.map(([o, c, h, l], i) => {
          const x = i * cw + cw / 2, up = c >= o, col = up ? "#3DDC97" : "#FF6B6B", top = data.Y(Math.max(o, c));
          return (<g key={i}><line x1={x} y1={data.Y(h)} x2={x} y2={data.Y(l)} stroke={col} strokeWidth="1.2" vectorEffect="non-scaling-stroke" /><rect x={x - cw * 0.34} y={top} width={cw * 0.68} height={Math.max(1.5, data.Y(Math.min(o, c)) - top)} rx="1" fill={col} /></g>);
        })}
        <line x1="0" y1={last} x2={W} y2={last} stroke="#3DDC97" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      </svg>
      <svg width="100%" height="56" viewBox={`0 0 ${W} 60`} preserveAspectRatio="none" aria-hidden="true">
        {data.cs.map(([o, c], i) => <rect key={i} x={i * cw + cw * 0.16} y={60 - data.vol[i]} width={cw * 0.68} height={data.vol[i]} fill={c >= o ? "rgba(61,220,151,0.35)" : "rgba(255,107,107,0.35)"} />)}
      </svg>
    </div>
  );
}

export function Intervals({ extra, value, onChange }: { extra?: boolean; value?: string; onChange?: (v: string) => void }) {
  const [own, setOwn] = useState("15m");
  const iv = value ?? own;
  const setIv = (v: string) => { setOwn(v); onChange?.(v); };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
      <div className="hscroll" style={{ gap: 2 }}>
        {["1m", "5m", "15m", "1h", "4h", "1d"].map((t) => (
          <button key={t} type="button" onClick={() => setIv(t)} className="mono" style={{ height: 30, padding: "0 10px", borderRadius: 7, border: 0, background: iv === t ? "#1E2129" : "transparent", color: iv === t ? "var(--text)" : "var(--dim)", fontWeight: 600, fontSize: 12 }}>{t}</button>
        ))}
      </div>
      {extra && <div style={{ display: "flex", gap: 2 }}>{["MC", "Price", "Log"].map((t) => <button key={t} type="button" className="mono" style={{ height: 30, padding: "0 10px", borderRadius: 7, border: 0, background: "transparent", color: "var(--dim)", fontWeight: 600, fontSize: 12 }}>{t}</button>)}</div>}
    </div>
  );
}

export function WhyMoving({ text }: { text: string }) {
  return <div className="ai-note"><ISpark size={16} color="var(--volt)" /><span><b>Why it&apos;s moving:</b> {text}</span></div>;
}

function Amt({ v, on, set }: { v: number; on: boolean; set: (n: number) => void }) {
  return <button type="button" className="seg mono" style={{ height: 38, minWidth: 0 }} aria-pressed={on} onClick={() => set(v)} data-on={on}><span style={{ color: on ? "var(--volt)" : undefined }}>${v}</span></button>;
}

export function TradePanel({ tick, price = 0.00412, withLimit = false }: { tick: string; price?: number; withLimit?: boolean }) {
  const { openLogin } = useApp();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [mode, setMode] = useState("Market");
  const [amt, setAmt] = useState("25");
  const n = Number(amt) || 0;
  const tokens = price > 0 ? n / price : 0;
  const fmt = (t: number) => (!Number.isFinite(t) || t <= 0 ? "—" : t >= 1e9 ? (t / 1e9).toFixed(2) + "B" : t >= 1e6 ? (t / 1e6).toFixed(2) + "M" : t >= 1e3 ? (t / 1e3).toFixed(1) + "K" : t.toFixed(t < 1 ? 4 : 0));
  const modes = withLimit ? ["Market", "Limit", "Auto"] : ["Market", "Auto"];
  return (
    <div className="card" style={{ borderRadius: 22, borderColor: "var(--line2)", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: 4, borderRadius: 14, background: "var(--bg)" }}>
        <button type="button" onClick={() => setSide("buy")} style={{ height: 42, borderRadius: 11, border: 0, fontWeight: 800, fontSize: 15, background: side === "buy" ? "var(--up)" : "transparent", color: side === "buy" ? "#04130C" : "var(--muted)" }}>Buy</button>
        <button type="button" onClick={() => setSide("sell")} style={{ height: 42, borderRadius: 11, border: 0, fontWeight: 800, fontSize: 15, background: side === "sell" ? "var(--down)" : "transparent", color: side === "sell" ? "#1A0505" : "var(--muted)" }}>Sell</button>
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 13, fontWeight: 600 }}>
        {modes.map((m) => <button key={m} type="button" onClick={() => setMode(m)} style={{ background: "none", border: 0, padding: "0 0 6px", color: mode === m ? "var(--text)" : "var(--dim)", borderBottom: mode === m ? "2px solid var(--volt)" : "2px solid transparent" }}>{m}</button>)}
      </div>
      <label htmlFor={`amt-${tick}`} style={{ fontSize: 13, display: "flex", justifyContent: "space-between" }} className="dim"><span>{side === "buy" ? "Amount" : "Sell amount"}</span><span>Cash <b className="mono" style={{ color: "var(--text)" }}>$0.00</b></span></label>
      <div style={{ display: "flex", alignItems: "center", height: 60, padding: "0 16px", borderRadius: 14, background: "var(--bg)", border: "1px solid var(--line3)" }}>
        <span className="mono dim" style={{ fontWeight: 700, fontSize: 26 }}>$</span>
        <input id={`amt-${tick}`} inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", font: "700 26px var(--mono)", paddingLeft: 4 }} />
        <span className="mono dim" style={{ fontWeight: 600, fontSize: 13 }}>USDC</span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>{[10, 25, 50, 100].map((v) => <Amt key={v} v={v} on={n === v} set={(x) => setAmt(String(x))} />)}</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span className="dim">You get</span><span className="mono">≈ {side === "buy" ? `${fmt(tokens)} ${tick}` : `$${n.toFixed(2)}`}</span></div>
      <button type="button" className={`btn lg ${side === "buy" ? "buy" : "sell"}`} onClick={openLogin} style={{ fontSize: 17 }}>{side === "buy" ? "Buy" : "Sell"} {tick}</button>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn ghost sm" style={{ flex: 1, height: 40 }}><IBell size={15} />Price alert</button>
        <button type="button" className="btn ghost sm" style={{ flex: 1, height: 40 }}><IShare size={15} />Share</button>
      </div>
    </div>
  );
}

export function AutoOrders({ available = true }: { available?: boolean }) {
  const [tp, setTp] = useState("+50%"); const [sl, setSl] = useState("-20%");
  const Chip = ({ t, on, set }: { t: string; on: boolean; set: (s: string) => void }) => <button type="button" className={`seg mono${on ? " on" : ""}`} style={{ height: 34, minWidth: 0, fontSize: 12 }} onClick={() => set(t)}>{t}</button>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14, borderRadius: 16, background: "var(--bg)", border: "1px solid var(--line)", opacity: available ? 1 : 0.55 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 700, fontSize: 13 }}>Auto orders</span><span className="mono" style={{ fontSize: 11, fontWeight: 600, color: available ? "var(--up)" : "var(--dim)" }}>{available ? "Available" : "Needs $10K+ daily volume"}</span></div>
      <span className="dim" style={{ fontSize: 12 }}>Take profit</span>
      <div style={{ display: "flex", gap: 6 }}>{["+25%", "+50%", "+100%", "2x"].map((t) => <Chip key={t} t={t} on={tp === t} set={setTp} />)}</div>
      <span className="dim" style={{ fontSize: 12 }}>Stop loss</span>
      <div style={{ display: "flex", gap: 6 }}>{["-10%", "-20%", "-30%", "Off"].map((t) => <Chip key={t} t={t} on={sl === t} set={setSl} />)}</div>
      <span style={{ fontSize: 12, color: "var(--faint)" }}>Sells automatically when the price hits your level.</span>
    </div>
  );
}

const Check = ({ txt, ok = true, val }: { txt: string; ok?: boolean; val: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
    <span style={{ width: 22, height: 22, borderRadius: 7, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: ok ? "rgba(61,220,151,0.14)" : "rgba(255,180,60,0.14)" }}>{ok ? <ICheck size={13} color="var(--up)" w={2.6} /> : <IAlert size={13} color="var(--warn)" w={2.4} />}</span>
    <span style={{ flex: 1, color: "var(--text2)" }}>{txt}</span><span className="mono" style={{ fontWeight: 600, fontSize: 12 }}>{val}</span>
  </div>
);
export function SafetyCard() {
  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}><IShield size={18} color="var(--up)" />AI safety check</span>
        <span className="pill mono" style={{ background: "rgba(61,220,151,0.14)", color: "var(--up)", fontWeight: 700 }}>Low risk</span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>Supply is fixed and nobody can mint more. The creator locked their coins for 24h and holds a small share. Holders are well spread.</p>
      <Check txt="Fixed supply, no minting" val="" />
      <Check txt="Creator lock" val="22h left" />
      <Check txt="Top 10 holders" val="18.4%" />
      <Check txt="Creator holds" val="3.1%" />
      <Check txt="Young coin, high volatility" ok={false} val="4m old" />
    </div>
  );
}
export function LockCard() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, background: "linear-gradient(135deg, rgba(212,255,58,0.10), rgba(92,255,176,0.04))", border: "1px solid rgba(212,255,58,0.25)" }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, background: "var(--volt)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><ILock size={18} color="#0A0B10" w={2.4} /></span>
      <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontWeight: 700, fontSize: 14 }}>Creator coins locked</span><span className="muted" style={{ fontSize: 12 }}>Unlocks in 21h 48m · cannot sell before</span></span>
      <span className="mono volt" style={{ fontWeight: 700, fontSize: 13 }}>24h</span>
    </div>
  );
}
export function BurnCard() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, background: "var(--card)", border: "1px solid var(--line)" }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,138,61,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><IFire size={18} color="var(--burn)" /></span>
      <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontWeight: 700, fontSize: 14 }}>Buyback &amp; burn</span><span className="muted" style={{ fontSize: 12 }}>Creator fees buy and burn this coin</span></span>
      <span className="mono" style={{ fontWeight: 700, fontSize: 13, color: "var(--burn)" }}>1.2M burned</span>
    </div>
  );
}

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

/** Real candles (price) with volume bars. Shows a calm empty state with fewer than 2 candles. */
export function LiveChart({ candles, height = 320, loading = false }: { candles: Candle[] | null; height?: number; loading?: boolean }) {
  const W = 880, H = 340;
  if (!candles || candles.length < 2) {
    return (
      <div className={loading || !candles ? "skel" : ""} style={{ height: height + 56, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {!loading && candles && <span className="dim" style={{ fontSize: 14 }}>Not enough trades yet for a chart.</span>}
      </div>
    );
  }
  const cs = candles.slice(-120);
  const n = cs.length, cw = W / n;
  let lo = Math.min(...cs.map((x) => x.l)), hi = Math.max(...cs.map((x) => x.h));
  if (hi === lo) { hi = hi * 1.01 || 1; lo = lo * 0.99; }
  const Y = (v: number) => H - 16 - ((v - lo) / (hi - lo)) * (H - 32);
  const vmax = Math.max(...cs.map((x) => x.v), 1e-12);
  const lastC = cs[n - 1];
  const last = Y(lastC.c);
  const lastUp = lastC.c >= cs[0].o;
  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Price chart">
        {[40, 100, 160, 220, 280].map((y) => <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="#1A1D25" />)}
        {cs.map((k, i) => {
          const x = i * cw + cw / 2, up = k.c >= k.o, col = up ? "#3DDC97" : "#FF6B6B", top = Y(Math.max(k.o, k.c));
          return (<g key={k.t}><line x1={x} y1={Y(k.h)} x2={x} y2={Y(k.l)} stroke={col} strokeWidth="1.2" vectorEffect="non-scaling-stroke" /><rect x={x - cw * 0.34} y={top} width={Math.max(1, cw * 0.68)} height={Math.max(1.5, Y(Math.min(k.o, k.c)) - top)} rx="1" fill={col} /></g>);
        })}
        <line x1="0" y1={last} x2={W} y2={last} stroke={lastUp ? "#3DDC97" : "#FF6B6B"} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      </svg>
      <svg width="100%" height="56" viewBox={`0 0 ${W} 60`} preserveAspectRatio="none" aria-hidden="true">
        {cs.map((k, i) => { const h = Math.max(1, (k.v / vmax) * 56); return <rect key={k.t} x={i * cw + cw * 0.16} y={60 - h} width={Math.max(1, cw * 0.68)} height={h} fill={k.c >= k.o ? "rgba(61,220,151,0.35)" : "rgba(255,107,107,0.35)"} />; })}
      </svg>
    </div>
  );
}
