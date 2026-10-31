"use client";
// The ArkhamPad airdrop: a promise, no dates or amounts. "Launch a coin, trade, earn the airdrop; the more you
// launch and trade, the bigger it is." The banner sits on Discover; the card on You shows what counts so far,
// in plain words (coins launched, trades, volume), never as "points".
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { fetchCreated, fetchMyTrades, usePoll } from "@/lib/ely";

export function AirdropBanner({ signedIn }: { signedIn: boolean }) {
  const tr = useT();
  return (
    <Link href={signedIn ? "/you/#airdrop" : "/create/"} className="e-airdrop">
      <span className="e-airdrop-ico" aria-hidden="true">🪂</span>
      <span>
        <b>{tr("The ArkhamPad airdrop")}</b>
        <small>{tr("Launch a coin. Trade. The more you launch and trade, the bigger your airdrop.")}</small>
      </span>
      <span className="e-airdrop-go" aria-hidden="true">→</span>
    </Link>
  );
}

export function AirdropCard({ me }: { me: string }) {
  const tr = useT();
  const created = usePoll(() => fetchCreated(me), 60_000, [me]);
  const trades = usePoll(() => fetchMyTrades(me, 2000), 60_000, [me]);
  const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 2 : 0 });
  const vol = (trades ?? []).reduce((s, t) => s + (t.hype || 0), 0);
  return (
    <section className="e-panel e-airdrop-card" id="airdrop">
      <h3 className="e-ph">🪂 {tr("Your airdrop")}</h3>
      <div className="e-airdrop-row">
        <div><b className="num">{created ? n(created.length) : "—"}</b><span>{tr("coins launched")}</span></div>
        <div><b className="num">{trades ? n(trades.length) : "—"}</b><span>{tr("trades")}</span></div>
        <div><b className="num">{trades ? n(vol) : "—"}</b><span>{tr("HYPE traded")}</span></div>
      </div>
      <p className="e-note" style={{ padding: "0 16px 14px" }}>{tr("Everything you launch and trade on ArkhamPad counts toward the ArkhamPad airdrop. The more you do, the bigger your share.")}</p>
    </section>
  );
}
