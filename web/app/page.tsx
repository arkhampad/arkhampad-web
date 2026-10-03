"use client";
import Link from "next/link";
import { useState } from "react";
import { coins, trades, traders } from "@/lib/mock";
import { Avatar } from "@/components/bits";
import { CoinRows, CoinTable, HotCard } from "@/components/market";
import { IFire, ISpark } from "@/components/icons";
import { useRouter } from "next/navigation";

const TABS = ["Trending", "New", "Gainers", "Bonding", "Graduated", "Top volume", "Losers"];
const CATS = ["All", "AI", "Animals", "Memes", "Gaming", "Culture", "Robinhood", "Base"];
const IDEAS = ["Funny animal", "Internet meme", "Robot / AI", "Sports", "Surprise me"];

export default function Discover() {
  const router = useRouter();
  const [tab, setTab] = useState("Trending");
  const [cat, setCat] = useState("All");
  const [idea, setIdea] = useState("");
  let list = [...coins];
  if (tab === "Gainers") list.sort((a, b) => b.chg - a.chg);
  if (tab === "Losers") list.sort((a, b) => a.chg - b.chg);
  if (cat === "Robinhood" || cat === "Base") list = list.filter((c) => c.chain === cat);
  const go = (e?: React.FormEvent) => { e?.preventDefault(); router.push(`/create/?idea=${encodeURIComponent(idea)}`); };

  return (
    <div className="wrap page">
      <section style={{ padding: "28px 0 12px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 18 }}>
        <span className="pill" style={{ border: "1px solid var(--line2)", color: "var(--text2)" }}><ISpark size={14} color="var(--volt)" />AI launchpad on Robinhood and Base</span>
        <h1 style={{ margin: 0, fontSize: "clamp(40px, 7vw, 76px)", lineHeight: 0.98, fontWeight: 900, letterSpacing: "-0.04em", maxWidth: 900 }}>
          Create and trade<br />with <span style={{ background: "linear-gradient(90deg, var(--volt), var(--mint))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>intelligence.</span>
        </h1>
        <p className="h-sub" style={{ maxWidth: 560, fontSize: 18 }}>Type an idea, get a ready coin. Deposit USDC and buy anything with one tap.</p>
        <form onSubmit={go} style={{ width: "100%", maxWidth: 760, display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 8px 18px", borderRadius: 18, background: "#12141B", border: "1px solid var(--line3)", flexWrap: "wrap" }}>
          <ISpark size={20} color="var(--volt)" />
          <label htmlFor="idea" className="sr">Describe your coin</label>
          <input id="idea" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Describe your coin… a frog astronaut who only buys the dip" style={{ flex: "1 1 220px", minWidth: 0, height: 48, background: "transparent", border: 0, outline: "none", fontSize: 16 }} />
          <button type="submit" className="btn volt" style={{ height: 50, padding: "0 22px", fontSize: 15, borderRadius: 13 }}>Generate coin</button>
        </form>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {IDEAS.map((t) => <button key={t} type="button" className="chip sm" onClick={() => router.push(`/create/?idea=${encodeURIComponent(t)}`)}>{t}</button>)}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><IFire size={20} color="var(--burn)" /><h2 className="sec-title" style={{ fontSize: 22 }}>Hot right now</h2></div>
        <div className="grid3 hide-m">{coins.slice(0, 3).map((c) => <HotCard key={c.id} c={c} />)}</div>
        <div className="hscroll show-m" style={{ gap: 12, margin: "0 -16px", padding: "0 16px" }}>{coins.slice(0, 3).map((c) => <div key={c.id} style={{ flex: "none", width: 280 }}><HotCard c={c} /></div>)}</div>
      </section>

      <section className="row">
        <div className="main-col">
          <div className="hscroll">{TABS.map((t) => <button key={t} type="button" className={`chip${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
          <div className="hscroll" style={{ gap: 6 }}>{CATS.map((t) => <button key={t} type="button" className={`chip sm${cat === t ? " on" : ""}`} onClick={() => setCat(t)}>{t}</button>)}</div>
          <div className="hide-m"><CoinTable list={list} /></div>
          <div className="show-m" style={{ margin: "0 -16px" }}><CoinRows list={list} /></div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <span className="dim" style={{ fontSize: 13 }}>Ranked by real volume, launched here and on other DEXs.</span>
            <button type="button" className="btn">Load more</button>
          </div>
        </div>
        <aside className="side-col">
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 700 }}>Live trades</span><span className="mono up" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600 }}><span className="dot" style={{ background: "var(--up)" }} />Live</span></div>
            {trades.map((t, i) => (
              <div key={i} className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}><span><span style={{ color: "var(--text)" }}>{t.who}</span> {t.act}</span><span><span className={t.up ? "up" : "down"}>{t.amt}</span> {t.tick}</span></div>
            ))}
          </div>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 700 }}>Top traders this week</span><Link href="/traders/" className="volt" style={{ fontSize: 13 }}>See all</Link></div>
            {traders.slice(0, 4).map((t) => (
              <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono dim" style={{ fontSize: 12, width: 14 }}>{t.rank}</span><Avatar name={t.name} c1={t.c1} c2={t.c2} size={32} round />
                <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{t.name}</span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}><span className="mono up" style={{ fontWeight: 700, fontSize: 13 }}>{t.pnl}</span><span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>win {t.win}</span></span>
              </div>
            ))}
            <Link href="/traders/" className="btn ghost sm" style={{ height: 40 }}>Follow and copy with one tap</Link>
          </div>
          <div className="card" style={{ background: "var(--volt)", color: "var(--bg)", border: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 17 }}>Invite friends, earn on every trade</span>
            <span style={{ fontSize: 13, lineHeight: 1.45 }}>You get a share of our fee on everything your friends trade.</span>
            <Link href="/profile/" className="btn" style={{ alignSelf: "flex-start", height: 38, background: "var(--bg)", color: "var(--text)", border: 0 }}>Get my link</Link>
          </div>
        </aside>
      </section>
    </div>
  );
}
