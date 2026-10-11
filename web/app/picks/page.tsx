"use client";
import Link from "next/link";
import { Avatar } from "@/components/bits";
import { pickResults, usd, ago, useLive, type CoinPick } from "@/lib/live";

// Every ArkhamPad Pick with its real result 1 hour and 24 hours later, wins and losses alike.
const pct = (a: number, b: number) => ((b - a) / a) * 100;
const fmt = (v: number) => `${v >= 0 ? "+" : ""}${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}%`;
const chainName = (id: number) => (id === 8453 ? "Base" : id === 56 ? "BNB Chain" : id === 4663 ? "Robinhood" : "");

function Kpi({ k, v, d }: { k: string; v: string; d?: string }) {
  return (
    <div className="card" style={{ borderRadius: 18, padding: 16, gap: 6 }}>
      <span className="dim" style={{ fontSize: 12 }}>{k}</span>
      <span className="mono" style={{ fontSize: 24, fontWeight: 800 }}>{v}</span>
      {d && <span className="dim" style={{ fontSize: 12 }}>{d}</span>}
    </div>
  );
}

function stats(list: CoinPick[], key: "mc_1h" | "mc_24h") {
  const done = list.filter((p) => p[key] !== null && p.pick_mc > 0);
  if (!done.length) return null;
  const ch = done.map((p) => pct(p.pick_mc, p[key] as number));
  const up = ch.filter((c) => c > 0).length;
  const sorted = [...ch].sort((a, b) => a - b);
  return { n: done.length, up, rate: (up / done.length) * 100, median: sorted[Math.floor(sorted.length / 2)] };
}

function Result({ p, k }: { p: CoinPick; k: "mc_1h" | "mc_24h" }) {
  const v = p[k];
  if (v === null) return <span className="dim">pending</span>;
  const c = pct(p.pick_mc, v);
  return <span style={{ color: c > 0 ? "var(--up)" : "var(--down)", fontWeight: 700 }}>{fmt(c)}</span>;
}

export default function Picks() {
  const r = useLive(() => pickResults(200), [], 60_000);
  const list = r.data ?? [];
  const s1 = stats(list, "mc_1h"), s24 = stats(list, "mc_24h");
  return (
    <div className="wrap page">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 className="h-title" style={{ fontSize: "clamp(26px, 4vw, 40px)" }}>ArkhamPad Picks</h1>
        <span className="h-sub" style={{ fontSize: 15 }}>Coins picked for strong, healthy momentum, and what each one did next. Every pick is listed here, wins and losses. Market cap is measured from the same data at the time of the pick, after 1 hour and after 24 hours. Not financial advice.</span>
      </div>
      <div className="grid4" style={{ gap: 10 }}>
        <Kpi k="Up after 24 hours" v={s24 ? `${s24.rate.toFixed(0)}%` : "—"} d={s24 ? `${s24.up} of ${s24.n} picks` : "First results after a day"} />
        <Kpi k="Median after 24 hours" v={s24 ? fmt(s24.median) : "—"} />
        <Kpi k="Up after 1 hour" v={s1 ? `${s1.rate.toFixed(0)}%` : "—"} d={s1 ? `${s1.up} of ${s1.n} picks` : undefined} />
        <Kpi k="Picks so far" v={String(list.length)} />
      </div>
      <div className="panel" style={{ gap: 10 }}>
        <b>All picks</b>
        {r.data === null ? <div className="skel" style={{ height: 200 }} /> : list.length === 0 ? (
          <span className="dim" style={{ fontSize: 14 }}>No picks yet. A coin is picked only when its signals are strong.</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div className="dim mono" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 90px 70px 70px", gap: 8, fontSize: 12, padding: "0 4px" }}>
              <span>Coin</span><span style={{ textAlign: "right" }}>Picked at</span><span style={{ textAlign: "right" }}>1 h</span><span style={{ textAlign: "right" }}>24 h</span>
            </div>
            {list.map((p) => (
              <Link key={p.id} href={`/coin/?c=${p.chain_id}-${p.address}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 90px 70px 70px", gap: 8, alignItems: "center", padding: "8px 4px", borderTop: "1px solid var(--line)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Avatar name={p.name ?? p.symbol ?? "?"} c1="#3B82F6" c2="#A3E635" img={p.image} size={32} />
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name ?? p.symbol}</b>
                    <span className="dim mono" style={{ fontSize: 12 }}>{p.symbol} · {chainName(p.chain_id)} · {ago(p.picked_at)} ago</span>
                  </span>
                </span>
                <span className="mono" style={{ textAlign: "right" }}>{usd(p.pick_mc)}</span>
                <span className="mono" style={{ textAlign: "right" }}><Result p={p} k="mc_1h" /></span>
                <span className="mono" style={{ textAlign: "right" }}><Result p={p} k="mc_24h" /></span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
