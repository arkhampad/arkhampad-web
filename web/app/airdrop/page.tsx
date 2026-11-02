"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@/components/wallet";
import { short, useLive } from "@/lib/live";
import { board, myPoints, type PointRow } from "@/lib/airdrop";

const fmt = (n: number, d = 0) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(d);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <b style={{ fontSize: 18 }}>{value}</b>
      <span className="dim" style={{ fontSize: 11 }}>{label}</span>
    </span>
  );
}

export default function Airdrop() {
  const w = useWallet();
  const rows = useLive(() => board(100), [], 60_000);
  const [me, setMe] = useState<PointRow | null>(null);
  useEffect(() => {
    let on = true;
    if (!w.address) { setMe(null); return; }
    myPoints(w.address).then((r) => { if (on) setMe(r); });
    return () => { on = false; };
  }, [w.address, rows.data]);

  const list = rows.data ?? null;

  return (
    <div className="wrap page">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 className="h-title" style={{ fontSize: "clamp(26px, 4vw, 40px)" }}>Airdrop points</h1>
        <span className="h-sub" style={{ fontSize: 14 }}>
          Earn points for real activity on ArkhamPad: 1 point per HYPE you trade, +50 per coin you launch.
          Hold a Genesis NFT and everything counts <b>2x</b>. The leaderboard is live, from on-chain trades.
        </span>
      </div>

      {/* your standing */}
      <div className="card" style={{ padding: 18, gap: 14 }}>
        {!w.address ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <b>Connect your wallet to see your points.</b>
            <button type="button" className="chip on" onClick={() => w.login()}>Connect</button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span className="dim" style={{ fontSize: 12 }}>Your points</span>
                <b className="mono" style={{ fontSize: 30 }}>{me ? fmt(me.points) : "—"}</b>
              </span>
              <span style={{ textAlign: "right", display: "flex", flexDirection: "column" }}>
                <span className="dim" style={{ fontSize: 12 }}>Rank</span>
                <b style={{ fontSize: 30 }}>{me ? `#${me.rank}` : "—"}</b>
              </span>
            </div>
            <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
              <Stat label="HYPE traded" value={me ? fmt(me.volume, 2) : "0"} />
              <Stat label="Coins launched" value={me ? String(me.launches) : "0"} />
              <Stat label="Genesis 2x" value={me?.genesis ? "Yes" : "No"} />
            </div>
            {!me?.genesis && (
              <Link href="/" className="dim" style={{ fontSize: 13 }}>
                No Genesis NFT yet — mint it to double every point. →
              </Link>
            )}
          </>
        )}
      </div>

      {/* leaderboard */}
      {list === null ? (
        <div className="skel" style={{ height: 320, borderRadius: 16 }} />
      ) : list.length === 0 ? (
        <div className="card" style={{ alignItems: "center", textAlign: "center", padding: 28 }}>
          <b>No points yet</b>
          <span className="dim" style={{ fontSize: 13 }}>Be the first: launch or trade a coin on ArkhamPad.</span>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0, gap: 0 }}>
          {list.map((t, i) => {
            const mine = w.address && t.wallet === w.address.toLowerCase();
            return (
              <div key={t.wallet} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderTop: i ? "1px solid var(--row)" : 0, background: mine ? "var(--row)" : undefined }}>
                <span className="mono dim" style={{ width: 26, fontSize: 13, textAlign: "right" }}>{t.rank}</span>
                <Link href={`/trader/?a=${t.wallet}`} style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <b className="mono" style={{ fontSize: 14 }}>
                    {short(t.wallet)} {t.genesis ? "⭐" : ""}
                  </b>
                  <span className="mono dim" style={{ fontSize: 11 }}>{fmt(t.volume, 1)} HYPE · {t.trades} trades · {t.launches} launched</span>
                </Link>
                <b className="mono" style={{ fontSize: 15 }}>{fmt(t.points)}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
