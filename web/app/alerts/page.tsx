"use client";
import Link from "next/link";
import { useState } from "react";
import { IArrowDown, IBell, IDollar, IStar, IUp } from "@/components/icons";
import { useApp } from "@/components/shell";

type N = { cat: string; icon: React.ReactNode; bg: string; title: string; body: string; t: string; action?: React.ReactNode; unread?: boolean };
export default function Alerts() {
  const { openSoon: openLogin } = useApp();
  const [tab, setTab] = useState("All");
  const today: N[] = [
    { cat: "Traders", bg: "linear-gradient(135deg, #7C5CFF, #3A2BFF)", icon: <span style={{ fontWeight: 900, fontSize: 14, color: "#fff" }}>MI</span>, title: "mira.eth bought $100 of MFROG", body: "A trader you follow just bought.", t: "12s ago", action: <button type="button" className="btn volt sm" onClick={openLogin}>Copy $25</button>, unread: true },
    { cat: "Price", bg: "rgba(61,220,151,0.14)", icon: <IUp size={18} color="var(--up)" />, title: "ORBD hit your price", body: "Orbit Dog reached $0.0213 (+41.8%).", t: "4m ago", action: <button type="button" className="btn sm" style={{ color: "var(--down)", background: "transparent", borderColor: "var(--line2)" }} onClick={openLogin}>Sell</button>, unread: true },
    { cat: "My coins", bg: "rgba(212,255,58,0.14)", icon: <IStar size={18} color="var(--volt-ink)" />, title: "Moonfrog graduated!", body: "Your coin reached $7.5K and moved to a locked pool.", t: "38m ago", action: <Link href="/coin/?c=mfrog" className="btn volt sm">View</Link>, unread: true },
  ];
  const earlier: N[] = [
    { cat: "Wallet", bg: "rgba(91,140,255,0.14)", icon: <IArrowDown size={18} color="var(--base)" />, title: "Deposit arrived", body: "$250.00 USDC is now in your cash balance.", t: "2h ago" },
    { cat: "My coins", bg: "rgba(61,220,151,0.14)", icon: <IDollar size={18} color="var(--up)" />, title: "Creator fees ready", body: "You earned $124.60 from Moonfrog trades.", t: "5h ago", action: <Link href="/profile/" className="btn buy sm">Claim</Link> },
    { cat: "Price", bg: "rgba(255,138,61,0.14)", icon: <IBell size={18} color="var(--burn)" />, title: "Auto order filled", body: "Take profit sold your GLCH at +50%.", t: "Yesterday" },
  ];
  const f = (l: N[]) => (tab === "All" ? l : l.filter((n) => n.cat === tab));
  const Row = ({ n }: { n: N }) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 16, background: n.unread ? "var(--raise)" : "transparent", border: `1px solid ${n.unread ? "var(--line2)" : "var(--row)"}` }}>
      <span style={{ width: 42, height: 42, borderRadius: 13, flex: "none", background: n.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>{n.icon}</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}><b style={{ fontSize: 14 }}>{n.title}</b><span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{n.body}</span><span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{n.t}</span></span>
      {n.action && <span style={{ alignSelf: "center", flex: "none" }}>{n.action}</span>}
      {n.unread && <span className="dot" style={{ width: 8, height: 8, background: "var(--volt)", marginTop: 6 }} />}
    </div>
  );
  const ask = async () => { try { if ("Notification" in window) await Notification.requestPermission(); } catch { /* unsupported */ } };
  return (
    <div className="wrap page" style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><span style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="pill" style={{ alignSelf: "flex-start", background: "rgba(255,180,60,0.14)", color: "var(--warn)" }}>Preview · sample data until launch</span><h1 className="h-title" style={{ fontSize: 34 }}>Alerts</h1></span><Link href="/profile/" className="btn ghost sm">Manage</Link></div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 16, background: "rgba(212,255,58,0.06)", border: "1px solid rgba(212,255,58,0.22)", flexWrap: "wrap" }}>
        <IBell size={18} color="var(--volt-ink)" /><span style={{ flex: "1 1 200px", fontSize: 13, lineHeight: 1.45, color: "var(--note)" }}>Turn on push to get alerts on your phone and computer, even when ArkhamPad is closed. On iPhone, add ArkhamPad to your home screen first.</span>
        <button type="button" className="btn volt sm" onClick={ask}>Turn on</button>
      </div>
      <div className="hscroll" style={{ gap: 6 }}>{["All", "Traders", "Price", "My coins", "Wallet"].map((t) => <button key={t} type="button" className={`chip sm${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
      <span className="mono" style={{ fontWeight: 700, fontSize: 12, color: "var(--faint)" }}>Today</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{f(today).map((n, i) => <Row key={i} n={n} />)}</div>
      <span className="mono" style={{ fontWeight: 700, fontSize: 12, color: "var(--faint)" }}>Earlier</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{f(earlier).map((n, i) => <Row key={i} n={n} />)}</div>
    </div>
  );
}
