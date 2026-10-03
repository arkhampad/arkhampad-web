"use client";
import Link from "next/link";
import { coins } from "@/lib/mock";
import { Avatar } from "@/components/bits";
import { IBack, ICopy, INext, ISpark, IX } from "@/components/icons";
import { useApp } from "@/components/shell";

const TOP = [["Top gainer", "Moonfrog", "+640%", "var(--up)", "#7C5CFF", "#3A2BFF"], ["Most volume", "Orbit Dog", "$4.02M", "var(--text)", "#2BB3FF", "#0066FF"], ["Fastest graduation", "Glitch", "3m 12s", "var(--volt)", "#F5C542", "#FF7A00"], ["Top trader", "mira.eth", "+$2,140", "var(--up)", "#7C5CFF", "#3A2BFF"]];
export default function Daily() {
  const { toast } = useApp();
  const post = "Today on @ArkhamPad: $MFROG +640%, 412 coins graduated, fastest in 3m 12s. arkhampad.com/daily/";
  return (
    <div className="wrap page" style={{ maxWidth: 1300 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="mono volt" style={{ fontWeight: 700, fontSize: 12 }}>ArkhamPad Daily</span><h1 className="h-title">Today&apos;s highlights</h1></div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><button type="button" className="icon-btn" aria-label="Previous day"><IBack size={16} /></button><span className="mono" style={{ fontWeight: 700, fontSize: 14, padding: "0 6px" }}>Oct 3, 2026</span><button type="button" className="icon-btn" aria-label="Next day"><INext size={16} /></button></div>
      </div>
      <div className="ai-note" style={{ padding: 20, borderRadius: 22, fontSize: 16, lineHeight: 1.6 }}><ISpark size={18} color="var(--volt)" /><span><b>AI recap:</b> A big day for animal coins. Moonfrog led with a 640% run and graduated in under an hour. 412 coins graduated, the most this week, and Base took the lead in new graduations.</span></div>
      <div className="grid4">{TOP.map(([k, n, v, col, c1, c2]) => (
        <div key={k} className="card" style={{ background: "linear-gradient(160deg, #151826, #0D0E13)", borderColor: "#22252F", borderRadius: 22, padding: 18, gap: 12 }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{k}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}><Avatar name={n} c1={c1} c2={c2} size={48} /><span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}><b style={{ fontSize: 18 }}>{n}</b><span className="mono" style={{ fontWeight: 700, color: col }}>{v}</span></span></span>
        </div>))}</div>
      <div className="row">
        <div className="main-col"><span className="sec-title">Graduated today</span>
          <div className="grid2" style={{ gap: 10 }}>{coins.slice(0, 6).map((c) => <Link key={c.id} href={`/coin/?c=${c.id}`} className="card" style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 16 }}><Avatar name={c.name} c1={c.c1} c2={c.c2} size={40} /><span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}><b style={{ fontSize: 14 }}>{c.name}</b><span className="mono dim" style={{ fontSize: 11 }}>{c.tick} · {c.chain}</span></span><span className="mono" style={{ fontWeight: 700 }}>{c.mc}</span></Link>)}</div>
        </div>
        <aside className="side-col"><div className="card">
          <span style={{ fontWeight: 800, fontSize: 16 }}>Share today&apos;s recap</span>
          <div style={{ padding: 14, borderRadius: 14, background: "var(--bg)", border: "1px solid var(--line2)", fontSize: 14, lineHeight: 1.55, color: "#E3E5E9" }}>{post}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <a className="btn white" style={{ flex: 1 }} href={`https://x.com/intent/post?text=${encodeURIComponent(post)}`} target="_blank" rel="noopener noreferrer"><IX size={15} color="#0A0B10" w={2.4} />Post on X</a>
            <button type="button" className="btn" style={{ flex: 1 }} onClick={async () => { try { await navigator.clipboard.writeText(post); toast("Copied"); } catch { /* blocked */ } }}><ICopy size={15} />Copy</button>
          </div>
        </div></aside>
      </div>
    </div>
  );
}
