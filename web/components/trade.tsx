"use client";
import { useState } from "react";

export function Intervals({ extra, value, onChange }: { extra?: boolean; value?: string; onChange?: (v: string) => void }) {
  const [own, setOwn] = useState("15m");
  const iv = value ?? own;
  const setIv = (v: string) => { setOwn(v); onChange?.(v); };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
      <div className="hscroll" style={{ gap: 2 }}>
        {["1m", "5m", "15m", "1h", "4h", "1d"].map((t) => (
          <button key={t} type="button" onClick={() => setIv(t)} className="mono" style={{ height: 30, padding: "0 10px", borderRadius: 7, border: 0, background: iv === t ? "var(--raise2)" : "transparent", color: iv === t ? "var(--text)" : "var(--dim)", fontWeight: 600, fontSize: 12 }}>{t}</button>
        ))}
      </div>
      {extra && <div style={{ display: "flex", gap: 2 }}>{["MC", "Price", "Log"].map((t) => <button key={t} type="button" className="mono" style={{ height: 30, padding: "0 10px", borderRadius: 7, border: 0, background: "transparent", color: "var(--dim)", fontWeight: 600, fontSize: 12 }}>{t}</button>)}</div>}
    </div>
  );
}

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
