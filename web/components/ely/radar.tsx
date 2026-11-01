"use client";
// Scout Radar — every Elysium coin ranked by its current smart-money signal. Reads the shared radar
// (lib/scout); no extra data sources. "Scout's Catch" is the single top coin, surfaced once at the top.
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { ago, money, short, usePoll, fetchHypeUsd, type EToken } from "@/lib/ely";
import { TokenAvatar } from "./shell";
import { ScoutMeter, ScoutRobot } from "./scout";
import { signalLabel, trackTag, useRadar, type ScoutCoin } from "@/lib/scout";

function mc(t: EToken, usd: number) { return money((t.mcap_hype ?? 0) * usd); }

/** The headline pick of the day: the top coin by signal. */
function Catch({ sc, usd }: { sc: ScoutCoin; usd: number }) {
  const tr = useT();
  const t = sc.token;
  const top = sc.events[0];
  const tag = top ? trackTag(top) : null;
  return (
    <Link href={`/t/?a=${t.address}`} className="e-panel scout-catch">
      <div className="scout-catch-badge"><ScoutRobot size={30} flash={sc.signal === "strong"} />{tr("Scout's Catch")}</div>
      <div className="scout-catch-main">
        <TokenAvatar t={t} size={48} />
        <div className="scout-catch-name">
          <b>{t.name} <span className="dim">{t.symbol}</span></b>
          <small className="dim">{tr("{s} smart buyers · {m} in the last 10 min", { s: sc.smartCount, m: sc.recentCount })}{tag ? ` · ${tag}` : ""}</small>
        </div>
        <div className="scout-catch-r">
          <ScoutMeter signal={sc.signal} />
          <b className="num">{mc(t, usd)}</b>
        </div>
      </div>
    </Link>
  );
}

function RadarRow({ sc, i, usd }: { sc: ScoutCoin; i: number; usd: number }) {
  const tr = useT();
  const t = sc.token;
  const top = sc.events[0];
  return (
    <Link href={`/t/?a=${t.address}`} className="e-row scout-row">
      <span className="dim num e-hide-m">{i + 1}</span>
      <span className="e-tok">
        <TokenAvatar t={t} size={38} />
        <span>
          <span className="l1"><b>{t.name}</b><span className="sym">{t.symbol}</span></span>
          <small className="dim">
            {top ? tr("{who} +{usd} · {ago}", { who: short(top.wallet), usd: money(top.usd), ago: ago(top.lastTs) }) : tr("{age} old", { age: ago(t.created_at) })}
          </small>
        </span>
      </span>
      <span className="scout-row-sig">
        <ScoutMeter signal={sc.signal} />
        <small className="dim">{tr("{s} smart", { s: sc.smartCount })}</small>
      </span>
      <span className="r num e-hide-m scout-row-cnt"><b className="up">{sc.recentCount}</b><small className="dim"> / 10m</small></span>
      <span className="r num"><b>{mc(t, usd)}</b></span>
    </Link>
  );
}

export function RadarView() {
  const tr = useT();
  const radar = useRadar();
  const usd = usePoll(fetchHypeUsd, 30_000) ?? 0;
  const top = radar?.top ?? [];
  const rest = top.slice(1);

  return (
    <main className="e-in e-page">
      <section className="e-hero scout-hero">
        <div>
          <span className="e-eyebrow"><ScoutRobot size={22} flash={!!radar?.hasStrong} />{tr("Smart Money Radar")}</span>
          <h1>{tr("Scout Radar")}</h1>
          <p>{tr("Coins ranked by the smart money moving into them right now — who's buying, how big, how fast.")}</p>
        </div>
      </section>

      {!radar && <div className="e-panel" style={{ padding: 14, display: "grid", gap: 10 }}>{Array.from({ length: 6 }, (_, i) => <div key={i} className="e-skel" style={{ height: 48 }} />)}</div>}

      {radar && top[0] && <Catch sc={top[0]} usd={usd} />}

      {radar && (
        <section className="e-panel">
          <div className="e-row h scout-row">
            <span className="e-hide-m">#</span>
            <span>{tr("Token")}</span>
            <span>{tr("Signal")}</span>
            <span className="r e-hide-m">{tr("Buyers")}</span>
            <span className="r">{tr("Mkt cap")}</span>
          </div>
          <div className="e-rows">
            {rest.map((sc, i) => <RadarRow key={sc.address} sc={sc} i={i + 1} usd={usd} />)}
          </div>
          {!top.length && <div className="e-empty">{tr("Quiet right now. Scout will light up when smart money starts moving.")}</div>}
        </section>
      )}

      <p className="scout-foot dim" style={{ textAlign: "center", padding: "4px 0 8px" }}>{tr("Signal, not advice. Scout reads on-chain buys — always do your own research.")}</p>
    </main>
  );
}
