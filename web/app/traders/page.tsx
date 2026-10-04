"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ScrollTabs } from "@/components/scrolltabs";
import { CopyButton, FollowButton } from "@/components/social";
import { useWallet } from "@/components/wallet";
import { ago, short, usd, useLive } from "@/lib/live";
import { board, copyAmount, feedOf, setCopyAmount, traderColors, useFollowing, type TraderRow } from "@/lib/traders";

const RANGES: [string, number][] = [["24h", 1], ["7d", 7], ["30d", 30], ["All time", 0]];
const SORTS = ["Profit", "ROI", "Win rate", "Volume", "Followers"] as const;

function Face({ a, size = 36 }: { a: string; size?: number }) {
  const [c1, c2] = traderColors(a);
  return <span className="av" style={{ width: size, height: size, borderRadius: "50%", background: `linear-gradient(135deg, ${c1}, ${c2})`, fontSize: Math.round(size * 0.32) }}>{a.slice(2, 4).toUpperCase()}</span>;
}
const signed = (v: number, d = 2) => `${v >= 0 ? "+" : "-"}${usd(Math.abs(v), d)}`;

export default function Traders() {
  const w = useWallet();
  const [range, setRange] = useState(7);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("Profit");
  const [amt, setAmt] = useState(25);
  useEffect(() => { setAmt(copyAmount()); }, []);
  const rows = useLive(() => board(range, 200), [range], 60_000);
  const { following } = useFollowing(w.address);
  const feed = useLive(() => feedOf(following, 20), [following.join(",")], 20_000);
  const key = (t: TraderRow) => (sort === "ROI" ? t.roi : sort === "Win rate" ? t.win : sort === "Volume" ? t.volume : sort === "Followers" ? t.followers : t.pnl);
  const list = [...(rows.data ?? [])].filter((t) => t.trades >= 1).sort((a, b) => key(b) - key(a));
  return (
    <div className="wrap page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 className="h-title" style={{ fontSize: "clamp(26px, 4vw, 40px)" }}>Top traders</h1>
          <span className="h-sub" style={{ fontSize: 14 }}>Real results from trades on ArkhamPad. Follow the best and copy their buys in one tap.</span>
        </div>
        <ScrollTabs gap={6}>{RANGES.map(([l, d]) => <button key={l} type="button" className={`chip sm${range === d ? " on" : ""}`} onClick={() => setRange(d)}>{l}</button>)}</ScrollTabs>
      </div>
      <div className="row">
        <div className="main-col">
          <ScrollTabs gap={6}>{SORTS.map((s) => <button key={s} type="button" className={`chip sm${sort === s ? " on" : ""}`} onClick={() => setSort(s)}>{s}</button>)}</ScrollTabs>
          {rows.data === null ? <div className="skel" style={{ height: 300, borderRadius: 16 }} /> : list.length === 0 ? (
            <div className="card" style={{ alignItems: "center", textAlign: "center", padding: 28 }}><b>No trades in this period yet</b><span className="dim" style={{ fontSize: 13 }}>Be the first: launch or buy a coin.</span></div>
          ) : (
            <div className="panel" style={{ padding: 0, gap: 0 }}>
              {list.slice(0, 100).map((t, i) => (
                <div key={t.trader} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderTop: i ? "1px solid var(--row)" : 0 }}>
                  <span className="mono dim" style={{ width: 22, fontSize: 12 }}>{i + 1}</span>
                  <Link href={`/trader/?a=${t.trader}`} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                    <Face a={t.trader} />
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <b className="mono" style={{ fontSize: 14 }}>{short(t.trader)}</b>
                      <span className="mono dim" style={{ fontSize: 11 }}>{t.trades} trades · win {t.win.toFixed(0)}% · {t.followers} followers</span>
                    </span>
                  </Link>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 84 }}>
                    <b className={`mono ${t.pnl >= 0 ? "up" : "down"}`} style={{ fontSize: 14 }}>{signed(t.pnl)}</b>
                    <span className={`mono ${t.roi >= 0 ? "up" : "down"}`} style={{ fontSize: 11 }}>{t.roi >= 0 ? "+" : ""}{t.roi.toFixed(0)}%</span>
                  </span>
                  <FollowButton trader={t.trader} />
                </div>
              ))}
            </div>
          )}
        </div>
        <aside className="side-col">
          <div className="card" style={{ gap: 10 }}>
            <span style={{ fontWeight: 700 }}>Following</span>
            {!w.signedIn ? <button type="button" className="btn volt sm" onClick={w.login}>Log in to follow traders</button>
              : following.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>Follow traders to see their buys here and get an alert the moment they buy.</span>
              : (feed.data ?? []).length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No trades from people you follow yet.</span>
              : (feed.data ?? []).map((f) => (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <Face a={f.trader} size={28} />
                  <span style={{ flex: 1, minWidth: 0 }}><Link href={`/trader/?a=${f.trader}`} className="mono" style={{ fontWeight: 700 }}>{short(f.trader)}</Link> <span className={f.isBuy ? "up" : "down"}>{f.isBuy ? "bought" : "sold"}</span> <b className="mono">{usd(f.usdc, 2)}</b> <Link href={`/coin/?c=${f.chainId}-${f.coin}`} style={{ fontWeight: 700 }}>{f.tick}</Link> <span className="dim mono" style={{ fontSize: 11 }}>{ago(f.ts)}</span></span>
                  {f.isBuy && <CopyButton chainId={f.chainId} coin={f.coin} tick={f.tick} />}
                </div>
              ))}
          </div>
          <div className="card" style={{ gap: 10 }}>
            <span style={{ fontWeight: 700 }}>Copy in one tap</span>
            <span className="dim" style={{ fontSize: 13, lineHeight: 1.5 }}>When someone you follow buys, you get an alert with a Copy button. Pick how much each copy buys:</span>
            <div style={{ display: "flex", gap: 6 }}>{[10, 25, 50, 100].map((v) => <button key={v} type="button" className={`seg mono${amt === v ? " on" : ""}`} onClick={() => { setAmt(v); setCopyAmount(v); }}>${v}</button>)}</div>
            <span style={{ fontSize: 11, color: "var(--faint)" }}>Testnet · copies use test USDC</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
