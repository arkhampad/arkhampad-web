"use client";
import Link from "next/link";
import { useState } from "react";
import { catLabel, guides } from "@/lib/mock";
import { ISpark } from "@/components/icons";

export default function Learn() {
  const [cat, setCat] = useState("all");
  const list = cat === "all" ? guides : guides.filter((g) => g.cat === cat);
  return (
    <div className="wrap page" style={{ maxWidth: 1300 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, paddingTop: 12 }}>
        <h1 className="h-title" style={{ fontSize: "clamp(36px, 5vw, 52px)" }}>Learn</h1>
        <p className="h-sub" style={{ maxWidth: 560, fontSize: 17 }}>Short, clear guides to create, trade and stay safe. Or just ask.</p>
        <form onSubmit={(e) => e.preventDefault()} style={{ width: "100%", maxWidth: 720, display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 8px 16px", borderRadius: 16, background: "var(--field)", border: "1px solid var(--line3)", flexWrap: "wrap" }}>
          <ISpark size={18} color="var(--volt-ink)" /><label htmlFor="lq" className="sr">Ask a question</label>
          <input id="lq" placeholder="Ask anything, e.g. how do I withdraw to my exchange?" style={{ flex: "1 1 200px", minWidth: 0, height: 44, background: "transparent", border: 0, outline: "none", fontSize: 15 }} />
          <button type="submit" className="btn volt">Ask AI</button>
        </form>
      </div>
      <div className="hscroll" style={{ justifyContent: "center", gap: 6 }}>
        {[["all", "All"], ...Object.entries(catLabel)].map(([k, v]) => <button key={k} type="button" className={`chip sm${cat === k ? " on" : ""}`} onClick={() => setCat(k)}>{v}</button>)}
      </div>
      <div className="grid4">
        {list.map((g) => (
          <Link key={g.slug} href={`/learn/${g.slug}/`} className="card" style={{ padding: 14, gap: 12 }}>
            <span style={{ display: "block", height: 120, borderRadius: 14, background: `linear-gradient(135deg, ${g.c1}, ${g.c2})`, position: "relative", overflow: "hidden" }}>
              <span style={{ position: "absolute", right: -20, bottom: -30, width: 140, height: 140, borderRadius: "50%", border: "18px solid rgba(255,255,255,0.18)" }} />
              <span style={{ position: "absolute", left: 14, top: 12, padding: "4px 9px", borderRadius: 999, background: "rgba(10,11,16,0.55)", color: "#fff", fontSize: 11, fontWeight: 600 }}>{catLabel[g.cat]}</span>
            </span>
            <span style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.3 }}>{g.title}</span>
            <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{g.desc}</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--faint)" }}>{g.read} read</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
