"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { coins } from "@/lib/mock";
import { Avatar, Spark } from "@/components/bits";
import { AutoOrders, CandleChart, Intervals, TradePanel, WhyMoving } from "@/components/trade";
import { IDown, ISearch, ISend, ISpark } from "@/components/icons";

const POS = [["MFROG", "$61.80", "+$36.80", "+147%", true], ["ORBD", "$24.10", "+$4.10", "+20.5%", true], ["GHST", "$7.90", "-$2.10", "-21.0%", false]] as const;
const MT = ["★", "Trending", "New", "Gainers", "Bonding", "Graduated"];

function TerminalView() {
  const q = useSearchParams();
  const [sel, setSel] = useState(q.get("c") || coins[0].id);
  const [mt, setMt] = useState("Trending");
  const [bt, setBt] = useState("Positions");
  const [picker, setPicker] = useState(false);
  const c = coins.find((x) => x.id === sel) || coins[0];
  const volOk = parseFloat(c.vol.replace(/[^0-9.]/g, "")) * (c.vol.includes("M") ? 1000 : 1) >= 10;
  const List = (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {coins.map((x) => (
        <button key={x.id} type="button" onClick={() => { setSel(x.id); setPicker(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10, border: 0, background: x.id === sel ? "#161922" : "transparent", textAlign: "left" }}>
          <Avatar name={x.name} c1={x.c1} c2={x.c2} size={30} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}><span style={{ fontWeight: 700, fontSize: 13 }}>{x.tick}</span><span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{x.mc}</span></span>
          <span style={{ width: 44 }}><Spark vals={x.spark} up={x.chg >= 0} height={18} fill={false} stroke={2} /></span>
          <span className={`mono ${x.chg >= 0 ? "up" : "down"}`} style={{ fontWeight: 700, fontSize: 12, minWidth: 58, textAlign: "right" }}>{x.chg >= 0 ? "+" : ""}{x.chg.toFixed(1)}%</span>
        </button>
      ))}
    </div>
  );
  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", padding: "16px 20px 120px", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
      <aside className="panel hide-m" style={{ flex: "1 1 280px", maxWidth: 320, padding: 10, gap: 8 }}>
        <label className="search" style={{ height: 38, flex: "none" }}><ISearch size={15} color="var(--faint)" /><span className="sr">Search</span><input placeholder="Search coin or CA" /></label>
        <div className="hscroll" style={{ gap: 2 }}>{MT.map((t) => <button key={t} type="button" className={`tab${mt === t ? " on" : ""}`} style={{ height: 30, fontSize: 12, padding: "0 10px" }} onClick={() => setMt(t)}>{t}</button>)}</div>
        {List}
      </aside>
      <section style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <button type="button" className="show-m" onClick={() => setPicker(!picker)} style={{ display: "flex", alignItems: "center", gap: 10, height: 56, padding: "0 12px", borderRadius: 14, border: "1px solid #22252F", background: "#12141B" }}>
          <Avatar name={c.name} c1={c.c1} c2={c.c2} size={34} /><span style={{ flex: 1, textAlign: "left", display: "flex", flexDirection: "column" }}><span style={{ fontWeight: 800, fontSize: 15 }}>{c.tick}</span><span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>Tap to switch coin</span></span><IDown size={16} />
        </button>
        {picker && <div className="panel show-m" style={{ padding: 8 }}>{List}</div>}
        <div className="panel" style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px" }}>
          <Avatar name={c.name} c1={c.c1} c2={c.c2} size={44} />
          <span style={{ display: "flex", flexDirection: "column" }}><Link href={`/coin/?c=${c.id}`} style={{ fontWeight: 900, fontSize: 18 }}>{c.name} <span className="mono dim" style={{ fontWeight: 600, fontSize: 13 }}>{c.tick}</span></Link><span className="mono dim" style={{ fontSize: 12 }}>{c.chain} · 0x7a3f…c91e · {c.age}</span></span>
          <span style={{ flex: 1 }} />
          {[["Price", c.price, ""], ["MC", c.mc, ""], ["24h", `${c.chg >= 0 ? "+" : ""}${c.chg.toFixed(1)}%`, c.chg >= 0 ? "up" : "down"], ["Vol", c.vol, ""], ["Liq", c.liq, ""], ["Holders", c.holders, ""]].map(([k, v, cls]) => (
            <span key={k} className="hide-m" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 10px", borderLeft: "1px solid var(--line)" }}><span style={{ fontSize: 11, color: "var(--faint)" }}>{k}</span><span className={`mono ${cls}`} style={{ fontWeight: 700, fontSize: 14 }}>{v}</span></span>
          ))}
          <span className="show-m mono" style={{ fontWeight: 800, fontSize: 22 }}>{c.mc} <span className={c.chg >= 0 ? "up" : "down"} style={{ fontSize: 13 }}>{c.chg >= 0 ? "+" : ""}{c.chg.toFixed(1)}%</span></span>
        </div>
        <WhyMoving text="Volume is 5x the last hour and 140 new holders joined in 10 minutes. Top 10 wallets hold 18%." />
        <div className="panel" style={{ padding: 12, gap: 8 }}><Intervals extra /><CandleChart height={380} seed={c.tick.length * 3 + c.chg} /></div>
        <div className="show-m" style={{ display: "flex", flexDirection: "column", gap: 12 }}><TradePanel tick={c.tick} withLimit /><AutoOrders available={volOk} /></div>
        <div className="panel" style={{ padding: 12, gap: 8 }}>
          <div style={{ display: "flex", gap: 4 }} className="hscroll">{["Positions", "Trades", "Orders", "Holders"].map((t) => <button key={t} type="button" className={`tab${bt === t ? " on" : ""}`} onClick={() => setBt(t)}>{t}</button>)}</div>
          {bt === "Positions" ? POS.map(([t, v, p, pc, up]) => (
            <div key={t} className="mono" style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 0.9fr 1.1fr", alignItems: "center", padding: "10px 4px", borderTop: "1px solid #16181F", fontSize: 13 }}>
              <span style={{ fontFamily: "var(--sans)", fontWeight: 700 }}>{t}</span><span>{v}</span><span className={up ? "up" : "down"}>{p}</span><span className={up ? "up" : "down"}>{pc}</span>
              <span style={{ textAlign: "right" }}><button type="button" className="btn sm" style={{ height: 30, color: "var(--down)", background: "transparent", borderColor: "#3A2A2E" }}>Sell all</button></span>
            </div>
          )) : <div className="dim" style={{ fontSize: 13, padding: "14px 4px" }}>Log in to see your {bt.toLowerCase()}.</div>}
        </div>
      </section>
      <aside className="hide-m" style={{ flex: "1 1 320px", maxWidth: 380, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <TradePanel tick={c.tick} withLimit />
        <AutoOrders available={volOk} />
        <div className="card" style={{ padding: 12, gap: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13 }}><ISpark size={14} color="var(--volt)" />Ask AI about this coin</span>
          <form style={{ display: "flex", gap: 6 }} onSubmit={(e) => e.preventDefault()}><label className="sr" htmlFor="ask">Ask AI</label><input id="ask" className="inp" style={{ height: 40, fontSize: 13 }} placeholder="Who are the biggest holders?" /><button type="submit" aria-label="Send" className="btn volt" style={{ width: 40, height: 40, padding: 0, flex: "none" }}><ISend size={16} color="#0A0B10" w={2.4} /></button></form>
          <span style={{ fontSize: 11, color: "var(--faint)" }}>Info only, not financial advice.</span>
        </div>
      </aside>
    </div>
  );
}
export default function TerminalPage() { return <Suspense fallback={<div className="wrap page" />}><TerminalView /></Suspense>; }
