"use client";
import Link from "next/link";
import { useState } from "react";
import { coins } from "@/lib/mock";
import { Avatar, FrogArt, Spark } from "@/components/bits";
import { IShare, ISpark } from "@/components/icons";
import { useApp } from "@/components/shell";

const HOLD = [[0, "15.0M", "$61.80", "+$36.80", "+147%"], [2, "1.13K", "$24.10", "+$4.10", "+20.5%"], [4, "980", "$14.80", "+$2.30", "+18.4%"], [8, "165", "$7.90", "-$2.10", "-21.0%"]] as const;

function Stat({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="card" style={{ padding: "12px 14px", gap: 4, borderRadius: 14 }}><span className="dim" style={{ fontSize: 12 }}>{k}</span><span className={`mono ${cls || ""}`} style={{ fontWeight: 700, fontSize: 17 }}>{v}</span></div>;
}

export default function Profile() {
  const { openFunds, toast } = useApp();
  const [tab, setTab] = useState("Holdings");
  const [alerts, setAlerts] = useState({ push: true, traders: true, price: true, mine: false });
  const link = "arkhampad.com/?ref=you";
  return (
    <div className="wrap page" style={{ maxWidth: 1300 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span className="av" style={{ width: 68, height: 68, borderRadius: 22, background: "linear-gradient(135deg, var(--volt), var(--mint))", color: "var(--on-volt)", fontSize: 24, fontWeight: 900 }}>YO</span>
        <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 4 }}><span style={{ fontWeight: 900, fontSize: 26, letterSpacing: -0.6 }}>you</span><span className="mono dim" style={{ fontSize: 13 }}>Joined Oct 2026 · <b style={{ color: "var(--text)" }}>12</b> following · <b style={{ color: "var(--text)" }}>48</b> followers</span></div>
        <div style={{ display: "flex", gap: 8 }}><button type="button" className="btn ghost sm" style={{ height: 40 }}>Edit profile</button><button type="button" className="icon-btn" aria-label="Share profile"><IShare size={16} /></button></div>
      </div>
      <div className="row">
        <div className="main-col">
          <div style={{ borderRadius: 26, padding: 1, background: "linear-gradient(140deg, var(--volt), var(--line2) 40%, var(--line2) 70%, var(--mint))" }}>
            <div style={{ borderRadius: 25, background: "var(--card)", padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><span className="dim" style={{ fontSize: 13 }}>Total balance</span><span className="mono" style={{ fontWeight: 800, fontSize: "clamp(34px, 5vw, 46px)", letterSpacing: -1.6 }}>$356.10</span><span className="mono up" style={{ fontWeight: 700, fontSize: 14 }}>+$41.10 today · +13.0%</span></div>
                <div style={{ display: "flex", gap: 10 }}><button type="button" className="btn buy" style={{ height: 52, padding: "0 24px", borderRadius: 15 }} onClick={() => openFunds("deposit")}>Deposit</button><button type="button" className="btn" style={{ height: 52, padding: "0 24px", borderRadius: 15 }} onClick={() => openFunds("withdraw")}>Withdraw</button></div>
              </div>
              <div className="grid3" style={{ gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}><Stat k="Cash (USDC)" v="$248.50" /><Stat k="Coins" v="$107.60" /><Stat k="All-time profit" v="+$88.40" cls="up" /></div>
            </div>
          </div>
          <div className="ai-note"><ISpark size={16} color="var(--volt-ink)" /><span><b>Your week:</b> Best trade was MFROG (+147%). You made most of your profit on Base. One coin is down more than 20%.</span></div>
          <div className="panel">
            <div className="hscroll" style={{ gap: 4 }}>{["Holdings", "Activity", "Orders", "Following"].map((t) => <button key={t} type="button" className={`tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
            {tab === "Holdings" ? HOLD.map(([i, amt, val, pnl, pc]) => { const c = coins[i]; const up = !pnl.startsWith("-"); return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", borderTop: "1px solid var(--row)" }}>
                <Link href={`/coin/?c=${c.id}`}><Avatar name={c.name} c1={c.c1} c2={c.c2} size={40} /></Link>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><b style={{ fontSize: 15 }}>{c.name}</b><span className="mono dim" style={{ fontSize: 12 }}>{amt} {c.tick}</span></span>
                <span className="hide-m" style={{ width: 70 }}><Spark vals={c.spark} up={up} height={26} fill={false} stroke={2.4} /></span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 86 }}><span className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{val}</span><span className={`mono ${up ? "up" : "down"}`} style={{ fontWeight: 600, fontSize: 12 }}>{pnl} · {pc}</span></span>
                <button type="button" className="btn sm" style={{ color: "var(--down)", background: "transparent", borderColor: "var(--line2)" }}>Sell</button>
              </div>); }) : <div className="dim" style={{ fontSize: 13, padding: "14px 4px" }}>Nothing here yet.</div>}
          </div>
        </div>
        <aside className="side-col">
          <div className="card" style={{ background: "var(--volt)", color: "var(--on-volt)", border: 0, gap: 10 }}>
            <span style={{ fontWeight: 900, fontSize: 18 }}>Invite friends, earn on every trade</span>
            <span style={{ fontSize: 13, lineHeight: 1.45 }}>You get a share of our fee on everything your friends trade. Paid to your cash balance.</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px 6px 12px", borderRadius: 12, background: "rgba(10,11,16,0.08)" }}>
              <span className="mono" style={{ flex: 1, fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{link}</span>
              <button type="button" className="btn sm" style={{ background: "var(--bg)", color: "var(--text)", border: 0 }} onClick={async () => { try { await navigator.clipboard.writeText("https://" + link); toast("Invite link copied"); } catch { /* blocked */ } }}>Copy link</button>
            </div>
            <div className="grid2 keep" style={{ gap: 8 }}>{[["Friends joined", "12"], ["You earned", "$18.20"]].map(([a, b]) => <div key={a} style={{ padding: "10px 12px", borderRadius: 12, background: "rgba(10,11,16,0.08)" }}><span style={{ fontSize: 11 }}>{a}</span><div className="mono" style={{ fontWeight: 800, fontSize: 20 }}>{b}</div></div>)}</div>
          </div>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 800, fontSize: 16 }}>My coins</span><span className="dim" style={{ fontSize: 12 }}>1 created</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ width: 40, height: 40, borderRadius: 12, overflow: "hidden" }}><FrogArt /></span><span style={{ flex: 1, display: "flex", flexDirection: "column" }}><b>Moonfrog</b><span className="mono dim" style={{ fontSize: 12 }}>Creator fees earned</span></span><span className="mono up" style={{ fontWeight: 800, fontSize: 16 }}>$124.60</span></div>
            <button type="button" className="btn buy" style={{ height: 46 }}>Claim $124.60 to cash</button>
          </div>
          <div className="card" style={{ gap: 14 }}>
            <span style={{ fontWeight: 800, fontSize: 16 }}>Alerts</span>
            {([["push", "Push notifications", "On this device, web and phone"], ["traders", "Traders I follow", "When they buy a coin"], ["price", "Price alerts", "When a coin hits your price"], ["mine", "My coins", "Big buys and graduation"]] as const).map(([k, t, d]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 14, cursor: "pointer" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontWeight: 600 }}>{t}</span><span className="dim" style={{ fontSize: 12 }}>{d}</span></span>
                <input type="checkbox" checked={alerts[k]} onChange={(e) => setAlerts({ ...alerts, [k]: e.target.checked })} style={{ width: 22, height: 22, accentColor: "#D4FF3A" }} />
              </label>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
