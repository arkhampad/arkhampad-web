"use client";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/bits";
import { Bars } from "@/components/charts";
import { usd, useLive } from "@/lib/live";
import { dailySeries, dayRecap, platformStats } from "@/lib/insights";

const Kpi = ({ k, v, d }: { k: string; v: string; d?: string }) => (
  <div className="card" style={{ borderRadius: 18, padding: 16, gap: 6 }}><span className="dim" style={{ fontSize: 12 }}>{k}</span><span className="mono" style={{ fontSize: 24, fontWeight: 800 }}>{v}</span>{d && <span className="dim" style={{ fontSize: 12 }}>{d}</span>}</div>
);
const n0 = (v: number) => v.toLocaleString("en-US");

export default function Analytics() {
  const [days, setDays] = useState(30);
  const s = useLive(platformStats, [], 60_000);
  const series = useLive(() => dailySeries(days), [days], 120_000);
  const today = useLive(() => dayRecap(), [], 60_000);
  const d = series.data ?? [];
  const labels = d.map((x) => x.day.slice(5));
  return (
    <div className="wrap page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><h1 className="h-title" style={{ fontSize: "clamp(26px, 4vw, 40px)" }}>Analytics</h1><span className="h-sub" style={{ fontSize: 14 }}>Live numbers from every trade on ArkhamPad. Testnet.</span></div>
        <div style={{ display: "flex", gap: 6 }}>{[7, 30, 90].map((v) => <button key={v} type="button" className={`chip sm${days === v ? " on" : ""}`} onClick={() => setDays(v)}>{v}d</button>)}</div>
      </div>
      <div className="grid4" style={{ gap: 10 }}>
        <Kpi k="Volume 24h" v={s.data ? usd(s.data.volume_24h) : "—"} d={s.data ? `${usd(s.data.volume_7d)} this week` : undefined} />
        <Kpi k="Trades 24h" v={s.data ? n0(s.data.trades_24h) : "—"} d={s.data ? `${n0(s.data.trades_all)} all time` : undefined} />
        <Kpi k="Traders 24h" v={s.data ? n0(s.data.traders_24h) : "—"} d={s.data ? `${n0(s.data.traders_all)} all time` : undefined} />
        <Kpi k="Coins launched" v={s.data ? n0(s.data.coins_total) : "—"} d={s.data ? `${n0(s.data.coins_24h)} today · ${n0(s.data.graduated)} graduated` : undefined} />
      </div>
      <div className="row">
        <div className="main-col">
          <div className="panel" style={{ gap: 12 }}><b>Daily volume</b>{series.data === null ? <div className="skel" style={{ height: 180 }} /> : <Bars vals={d.map((x) => x.volume)} labels={labels} fmt={(v) => usd(v)} />}</div>
          <div className="grid2" style={{ gap: 10 }}>
            <div className="panel" style={{ gap: 12 }}><b>Coins launched</b>{series.data === null ? <div className="skel" style={{ height: 140 }} /> : <Bars vals={d.map((x) => x.launches)} labels={labels} color="#7C5CFF" height={140} />}</div>
            <div className="panel" style={{ gap: 12 }}><b>Daily traders</b>{series.data === null ? <div className="skel" style={{ height: 140 }} /> : <Bars vals={d.map((x) => x.traders)} labels={labels} color="#2BB3FF" height={140} />}</div>
          </div>
        </div>
        <aside className="side-col">
          <div className="card" style={{ gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><b>Most traded today</b><Link href="/daily/" className="volt" style={{ fontSize: 13 }}>Daily recap</Link></div>
            {today.data === null ? <div className="skel" style={{ height: 160 }} /> : (today.data?.top ?? []).length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No trades yet today.</span> :
              today.data!.top.map((c, i) => (
                <Link key={`${c.chain_id}-${c.coin}`} href={`/coin/?c=${c.chain_id}-${c.coin}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: i ? "1px solid var(--row)" : 0 }}>
                  <Avatar name={c.name} c1="#7C5CFF" c2="#3A2BFF" size={32} img={c.image_url} />
                  <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13 }}>{c.name}</b> <span className="mono dim" style={{ fontSize: 11 }}>{c.symbol}</span></span>
                  <span className="mono" style={{ fontSize: 13 }}>{usd(c.vol ?? 0)}</span>
                </Link>
              ))}
          </div>
          <div className="card" style={{ gap: 6 }}><b>Fees generated</b><span className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{s.data ? usd(s.data.fees_all, 2) : "—"}</span><span className="dim" style={{ fontSize: 12 }}>All trading fees on ArkhamPad so far.</span></div>
        </aside>
      </div>
    </div>
  );
}
