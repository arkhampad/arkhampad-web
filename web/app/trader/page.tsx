"use client";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CopyButton, FollowButton } from "@/components/social";
import { ago, short, usd, useLive } from "@/lib/live";
import { board, feedOf, traderColors } from "@/lib/traders";

function TraderView() {
  const a = (useSearchParams().get("a") || "").toLowerCase();
  const valid = /^0x[0-9a-f]{40}$/.test(a);
  const all = useLive(async () => (valid ? (await board(0, 1, a))[0] ?? null : null), [a], 60_000);
  const week = useLive(async () => (valid ? (await board(7, 1, a))[0] ?? null : null), [a], 60_000);
  const trades = useLive(() => (valid ? feedOf([a], 40) : Promise.resolve([])), [a], 20_000);
  if (!valid) return <div className="wrap page"><h1 className="h-title" style={{ fontSize: 28 }}>Trader not found</h1></div>;
  const [c1, c2] = traderColors(a);
  const s = all.data;
  const Box = ({ k, v, cls = "" }: { k: string; v: string; cls?: string }) => <div className="card" style={{ padding: 12, gap: 2, borderRadius: 14 }}><span className="dim" style={{ fontSize: 12 }}>{k}</span><b className={`mono ${cls}`}>{v}</b></div>;
  return (
    <div className="wrap page" style={{ maxWidth: 1000 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span className="av" style={{ width: 60, height: 60, borderRadius: "50%", background: `linear-gradient(135deg, ${c1}, ${c2})`, fontSize: 20 }}>{a.slice(2, 4).toUpperCase()}</span>
        <span style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}><b className="mono" style={{ fontSize: 22 }}>{short(a)}</b><span className="dim" style={{ fontSize: 13 }}>{s ? `${s.followers} followers` : " "}</span></span>
        <FollowButton trader={a} big />
      </div>
      <div className="grid3" style={{ gap: 10 }}>
        <Box k="Profit (all time)" v={s ? `${s.pnl >= 0 ? "+" : "-"}${usd(Math.abs(s.pnl), 2)}` : "—"} cls={s && s.pnl < 0 ? "down" : "up"} />
        <Box k="Profit (7d)" v={week.data ? `${week.data.pnl >= 0 ? "+" : "-"}${usd(Math.abs(week.data.pnl), 2)}` : "—"} cls={week.data && week.data.pnl < 0 ? "down" : "up"} />
        <Box k="ROI" v={s ? `${s.roi.toFixed(0)}%` : "—"} />
        <Box k="Win rate" v={s ? `${s.win.toFixed(0)}%` : "—"} />
        <Box k="Trades" v={s ? String(s.trades) : "—"} />
        <Box k="Volume" v={s ? usd(s.volume) : "—"} />
      </div>
      <div className="panel" style={{ gap: 0 }}>
        <span style={{ fontWeight: 700, padding: "0 0 8px" }}>Latest trades</span>
        {trades.data === null ? <div className="skel" style={{ height: 120, borderRadius: 12 }} /> : trades.data.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No trades yet.</span> :
          trades.data.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--row)", fontSize: 13 }}>
              <span className={t.isBuy ? "up" : "down"} style={{ fontWeight: 700, width: 36 }}>{t.isBuy ? "Buy" : "Sell"}</span>
              <Link href={`/coin/?c=${t.chainId}-${t.coin}`} style={{ flex: 1, minWidth: 0, fontWeight: 700 }}>{t.name} <span className="mono dim">{t.tick}</span></Link>
              <span className="mono">{usd(t.usdc, 2)}</span>
              <span className="mono dim" style={{ width: 40, textAlign: "right" }}>{ago(t.ts)}</span>
              {t.isBuy && <CopyButton chainId={t.chainId} coin={t.coin} tick={t.tick} />}
            </div>
          ))}
      </div>
    </div>
  );
}
export default function TraderPage() { return <Suspense fallback={<div className="wrap page" />}><TraderView /></Suspense>; }
