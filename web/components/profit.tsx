"use client";
// "Share your result" sheet with the profit card.
import { useEffect, useState } from "react";
import { pnlCard, sharePnl, type Pnl } from "@/lib/share";

export function ProfitSheet({ p, onClose }: { p: Pnl; onClose: () => void }) {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let u = "";
    pnlCard(p).then((b) => { if (b) { u = URL.createObjectURL(b); setImg(u); } });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [p]);
  const up = p.pnl >= 0;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Your result" style={{ gap: 12 }}>
        <span style={{ fontWeight: 900, fontSize: 22 }}>{up ? "Nice trade! 🎉" : "Your result"}</span>
        <span className="dim" style={{ fontSize: 14 }}>{up ? "+" : ""}{p.pct.toFixed(1)}% on {p.tick} ({up ? "+" : "-"}${Math.abs(p.pnl).toFixed(2)})</span>
        {img ? <img src={img} alt="Result card" style={{ width: "100%", borderRadius: 14, border: "1px solid var(--line2)" }} /> : <div className="skel" style={{ aspectRatio: "16/9", borderRadius: 14 }} />}
        <button type="button" className="btn volt lg" onClick={() => sharePnl(p)}>Share your result</button>
        <button type="button" className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
