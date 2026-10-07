"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/bits";
import { IBack, ICopy, INext, ISpark, IX } from "@/components/icons";
import { useApp } from "@/components/shell";
import { short, usd, useLive } from "@/lib/live";
import { dayRecap, type Recap } from "@/lib/insights";
import { openX } from "@/lib/share";

const iso = (d: Date) => d.toISOString().slice(0, 10);
function summary(r: Recap) {
  if (!r.trades) return "A quiet day on ArkhamPad. No trades yet.";
  const parts = [`${r.trades} trades and ${usd(r.volume)} in volume from ${r.traders} traders.`];
  if (r.launches) parts.push(`${r.launches} new coin${r.launches === 1 ? "" : "s"} launched.`);
  if (r.gainer && (r.gainer.change ?? 0) > 0) parts.push(`Top gainer: $${r.gainer.symbol} (+${r.gainer.change}%).`);
  return parts.join(" ");
}

export default function Daily() {
  const { toast } = useApp();
  const [day, setDay] = useState(iso(new Date()));
  const rec = useLive(() => dayRecap(day), [day], 60_000);
  const [ai, setAi] = useState<string | null>(null);
  useEffect(() => {
    setAi(null);
    const r = rec.data;
    if (!r) return;
    let alive = true;
    fetch("/api/daily", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recap: r }) })
      .then((x) => x.json()).then((j) => { if (alive && j.text) setAi(j.text); }).catch(() => {});
    return () => { alive = false; };
  }, [rec.data?.day, rec.data?.trades]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = rec.data;
  const shift = (n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); if (d <= new Date()) setDay(iso(d)); };
  const text = r ? ai ?? summary(r) : "";
  const post = r ? `Today on @Arkhampad 📊\n\n${r.trades} trades · ${usd(r.volume)} volume · ${r.launches} new coins${r.gainer && (r.gainer.change ?? 0) > 0 ? `\nTop gainer: $${r.gainer.symbol} +${r.gainer.change}%` : ""}${r.top_volume ? `\nMost traded: $${r.top_volume.symbol}` : ""}` : "";
  const Card = ({ k, title, v, cls = "", c }: { k: string; title: string; v: string; cls?: string; c?: { chain_id: number; coin: string; name: string; image_url: string | null } | null }) => (
    <div className="card" style={{ gap: 8 }}>
      <span className="dim" style={{ fontSize: 12 }}>{k}</span>
      {c ? <Link href={`/coin/?c=${c.chain_id}-${c.coin}`} style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name={c.name} c1="#7C5CFF" c2="#3A2BFF" size={36} img={c.image_url} /><b>{title}</b></Link> : <b>{title}</b>}
      <span className={`mono ${cls}`} style={{ fontSize: 22, fontWeight: 800 }}>{v}</span>
    </div>
  );
  return (
    <div className="wrap page" style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><h1 className="h-title" style={{ fontSize: "clamp(26px, 4vw, 40px)" }}>Daily</h1><span className="h-sub" style={{ fontSize: 14 }}>What happened on ArkhamPad, day by day (UTC).</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => shift(-1)}><IBack size={18} /></button>
          <span className="mono" style={{ fontWeight: 700 }}>{day}</span>
          <button type="button" className="icon-btn" aria-label="Next day" onClick={() => shift(1)} disabled={day >= iso(new Date())}><INext size={18} /></button>
        </div>
      </div>
      {r === null ? <div className="skel" style={{ height: 120, borderRadius: 22 }} /> : <div className="ai-note" style={{ padding: 20, borderRadius: 22, fontSize: 16, lineHeight: 1.6 }}><ISpark size={18} color="var(--volt-ink)" /><span>{text}</span></div>}
      {r && (
        <>
          <div className="grid4" style={{ gap: 10 }}>
            <Card k="Top gainer" title={r.gainer ? r.gainer.name : "—"} v={r.gainer ? `${(r.gainer.change ?? 0) >= 0 ? "+" : ""}${r.gainer.change ?? 0}%` : "—"} cls={(r.gainer?.change ?? 0) >= 0 ? "up" : "down"} c={r.gainer} />
            <Card k="Most volume" title={r.top_volume ? r.top_volume.name : "—"} v={r.top_volume ? usd(r.top_volume.vol ?? 0) : "—"} c={r.top_volume} />
            <Card k="Biggest trade" title={r.biggest_trade ? `${short(r.biggest_trade.trader)} ${r.biggest_trade.is_buy ? "bought" : "sold"} $${r.biggest_trade.symbol}` : "—"} v={r.biggest_trade ? usd(r.biggest_trade.usdc, 2) : "—"} />
            <Card k="Launched" title="New coins" v={`${r.launches}`} />
          </div>
          <div className="card" style={{ gap: 10 }}>
            <b>Share today&apos;s recap</b>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--sans)", fontSize: 14, background: "var(--bg)", padding: 12, borderRadius: 12, border: "1px solid var(--line2)" }}>{post}</pre>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn white" style={{ flex: 1 }} onClick={() => openX(post)}><IX size={14} color="#0A0B10" w={2.4} />Post on X</button>
              <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => { navigator.clipboard?.writeText(post); toast("Copied"); }}><ICopy size={15} />Copy</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
