"use client";
import { useState } from "react";
import { traders } from "@/lib/mock";
import { Avatar, Spark } from "@/components/bits";
import { ISpark } from "@/components/icons";
import { useApp } from "@/components/shell";

const FEED = [["mira.eth", "#7C5CFF", "#3A2BFF", "$100", "MFROG", "12s"], ["kaan", "#FF8A3D", "#FF3D7F", "$50", "ORBD", "1m"], ["alphawolf", "#F5C542", "#FF7A00", "$25", "BCAT", "4m"]];

export default function Traders() {
  const { openLogin } = useApp();
  const [range, setRange] = useState("7d");
  const [sort, setSort] = useState("Profit");
  const [copyAmt, setCopyAmt] = useState(25);
  const [chain, setChain] = useState("All chains");
  const num = (v: string) => Number(String(v).replace(/[^0-9.-]/g, "")) || 0;
  const key = (t: (typeof traders)[number]) => (sort === "Win rate" ? num(t.win) : sort === "ROI" ? num(t.roi) : sort === "Followers" ? num(t.fol) : num(t.pnl));
  const top = traders.slice(0, 3), rest = [...traders.slice(3)].sort((a, b) => key(b) - key(a));
  return (
    <div className="wrap page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="pill" style={{ alignSelf: "flex-start", background: "rgba(255,180,60,0.14)", color: "var(--warn)" }}>Preview · sample data until launch</span><h1 className="h-title">Top traders</h1><p className="h-sub">Follow the best. Copy their buys in one tap.</p></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div className="hscroll" style={{ gap: 6 }}>{["24h", "7d", "30d", "All time"].map((t) => <button key={t} type="button" className={`chip sm${range === t ? " on" : ""}`} onClick={() => setRange(t)}>{t}</button>)}</div>
          <div className="hscroll" style={{ gap: 6 }}>{["All chains", "Robinhood", "Base"].map((t) => <button key={t} type="button" className={`chip sm${chain === t ? " on" : ""}`} onClick={() => setChain(t)}>{t}</button>)}</div>
        </div>
      </div>
      <div className="ai-note"><ISpark size={16} color="var(--volt-ink)" /><span><b>AI insight:</b> alphawolf has the steadiest results this month, with small losses and few big swings. mira.eth wins big but takes more risk.</span></div>
      <div className="grid3 hide-m">{top.map((t) => <Podium key={t.name} t={t} onFollow={openLogin} />)}</div>
      <div className="hscroll show-m" style={{ gap: 12, margin: "0 -16px", padding: "0 16px" }}>{top.map((t) => <div key={t.name} style={{ flex: "none", width: 280 }}><Podium t={t} onFollow={openLogin} /></div>)}</div>
      <div className="row">
        <div className="main-col">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}><span className="sec-title">Leaderboard</span><div className="hscroll" style={{ gap: 6 }}>{["Profit", "Win rate", "ROI", "Followers"].map((t) => <button key={t} type="button" className={`chip sm${sort === t ? " on" : ""}`} onClick={() => setSort(t)}>{t}</button>)}</div></div>
          <div className="tbl-box hide-m">
            <table className="tbl" style={{ minWidth: 860 }}>
              <thead><tr><th>#</th><th className="l">TRADER</th><th>PROFIT 7D</th><th>ROI</th><th>WIN RATE</th><th>TRADES</th><th>FOLLOWERS</th><th style={{ textAlign: "center" }}>30D</th><th /></tr></thead>
              <tbody>{rest.map((t) => (
                <tr key={t.name}>
                  <td className="dim" style={{ fontSize: 13 }}>{t.rank}</td>
                  <td className="l" style={{ fontFamily: "var(--sans)" }}><span style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name={t.name} c1={t.c1} c2={t.c2} size={36} /><span style={{ display: "flex", flexDirection: "column", gap: 3 }}><b>{t.name}</b><span className="volt" style={{ fontSize: 11 }}>{t.badge}</span></span></span></td>
                  <td className="up" style={{ fontWeight: 700, fontSize: 15 }}>{t.pnl}</td><td style={{ color: "var(--text2)" }}>{t.roi}</td><td>{t.win}</td><td style={{ color: "var(--text2)" }}>{t.trades}</td><td style={{ color: "var(--text2)" }}>{t.fol}</td>
                  <td style={{ width: 110 }}><Spark vals={t.spark} up height={30} fill={false} stroke={2.2} /></td>
                  <td><button type="button" className="btn outline-volt sm" onClick={openLogin}>Follow</button></td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="show-m" style={{ margin: "0 -16px" }}>{rest.map((t) => (
            <div key={t.name} className="lrow"><span className="mono dim" style={{ fontSize: 12, width: 18 }}>{t.rank}</span><Avatar name={t.name} c1={t.c1} c2={t.c2} size={40} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><b style={{ fontSize: 15 }}>{t.name}</b><span className="mono dim" style={{ fontSize: 11 }}>win {t.win} · {t.fol} fans</span></span>
              <span className="mono up" style={{ fontWeight: 700, fontSize: 14 }}>{t.pnl}</span><button type="button" className="btn outline-volt sm" onClick={openLogin}>Follow</button></div>))}</div>
        </div>
        <aside className="side-col">
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 800, fontSize: 16 }}>Following</span><span className="mono up" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600 }}><span className="dot" style={{ background: "var(--up)" }} />Live</span></div>
            {FEED.map(([who, c1, c2, amt, tick, t]) => (
              <div key={who} style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, background: "var(--bg)", border: "1px solid var(--line)" }}>
                <Avatar name={who} c1={c1} c2={c2} size={36} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 13 }}><b>{who}</b> <span className="dim">bought</span> <b className="mono up">{amt}</b> <b>{tick}</b></span><span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{t} ago</span></span>
                <button type="button" className="btn volt sm" onClick={openLogin}>Copy ${copyAmt}</button>
              </div>
            ))}
          </div>
          <div className="card">
            <span style={{ fontWeight: 800, fontSize: 16 }}>Copy in one tap</span>
            {[["Follow a trader", "Pick someone whose results you like."], ["Get an alert", "When they buy, you get a notification on web and phone."], ["Tap Copy", "Buy the same coin with your preset amount."]].map(([a, b], i) => (
              <div key={a} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}><span className="mono volt" style={{ width: 28, height: 28, flex: "none", borderRadius: 9, background: "var(--raise2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{i + 1}</span><span style={{ display: "flex", flexDirection: "column", gap: 2 }}><b style={{ fontSize: 14 }}>{a}</b><span className="dim" style={{ fontSize: 12, lineHeight: 1.45 }}>{b}</span></span></div>
            ))}
            <span className="dim" style={{ fontSize: 12 }}>My copy amount</span>
            <div style={{ display: "flex", gap: 6 }}>{[10, 25, 50, 100].map((v) => <button key={v} type="button" className={`seg mono${copyAmt === v ? " on" : ""}`} style={{ height: 38, minWidth: 0 }} onClick={() => setCopyAmt(v)}>${v}</button>)}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Podium({ t, onFollow }: { t: (typeof traders)[number]; onFollow: () => void }) {
  return (
    <div className="card" style={{ position: "relative", borderRadius: 24, padding: 20, gap: 14, borderColor: "var(--line2)", overflow: "hidden" }}>
      <span className="mono" style={{ position: "absolute", top: 14, right: 16, fontWeight: 900, fontSize: 44, color: "var(--line2)" }}>#{t.rank}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}><Avatar name={t.name} c1={t.c1} c2={t.c2} size={56} /><span style={{ display: "flex", flexDirection: "column", gap: 4 }}><b style={{ fontSize: 18 }}>{t.name}</b><span className="volt" style={{ alignSelf: "flex-start", padding: "3px 8px", borderRadius: 6, background: "rgba(212,255,58,0.10)", fontSize: 11, fontWeight: 600 }}>{t.badge}</span></span></span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span className="dim" style={{ fontSize: 12 }}>Profit · 7d</span><span className="mono up" style={{ fontWeight: 800, fontSize: 32, letterSpacing: -1 }}>{t.pnl}</span></span>
      <Spark vals={t.spark} up height={56} />
      <span style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, fontSize: 11, color: "var(--dim)" }}>
        <span>Win rate<br /><b className="mono" style={{ fontSize: 15, color: "var(--text)" }}>{t.win}</b></span><span>Trades<br /><b className="mono" style={{ fontSize: 15, color: "var(--text)" }}>{t.trades}</b></span><span>Followers<br /><b className="mono" style={{ fontSize: 15, color: "var(--text)" }}>{t.fol}</b></span>
      </span>
      <span className="muted" style={{ fontSize: 12 }}>Best trade <b className="mono" style={{ color: "var(--text)" }}>{t.best}</b></span>
      <button type="button" className="btn volt" style={{ height: 48, fontSize: 15 }} onClick={onFollow}>Follow</button>
    </div>
  );
}
