"use client";
// A dev's on-chain launch record: who they are, their reputation, and every coin they launched (that we
// index), newest first. Data-only (ely_tokens), reached from the Dev Card on a coin page.
import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n";
import { ago, compact, fetchHypeUsd, fetchTokens, money, pct, short, tokenColors, usePoll, type EToken } from "@/lib/ely";
import { TokenAvatar } from "./shell";
import { devRecordFromTokens, devRecordLine } from "@/lib/shield";

const upDown = (v: number | null | undefined) => ((v ?? 0) >= 0 ? "up" : "down");

export function DevView() {
  const tr = useT();
  const a = (useSearchParams().get("a") || "").toLowerCase();
  const valid = /^0x[0-9a-f]{40}$/.test(a);
  const tokens = usePoll(fetchTokens, 60_000);
  const usd = usePoll(fetchHypeUsd, 30_000) ?? 0;
  const mine = useMemo(() => (tokens ?? []).filter((t) => (t.creator || "").toLowerCase() === a).sort((x, y) => Date.parse(y.created_at || "0") - Date.parse(x.created_at || "0")), [tokens, a]);
  const rec = useMemo(() => (tokens ? devRecordFromTokens(a, tokens, usd) : null), [tokens, a, usd]);
  const [c1, c2] = tokenColors(valid ? a : "0x00");

  if (!valid) {
    return (
      <main className="e-in e-page">
        <div className="e-panel e-empty" style={{ padding: "60px 20px" }}>
          <h2 style={{ margin: "0 0 8px", color: "var(--e-text)" }}>{tr("Dev not found")}</h2>
          <Link href="/" className="e-btn pri">{tr("Back to Discover")}</Link>
        </div>
      </main>
    );
  }
  const rep = rec?.rep;
  return (
    <main className="e-in e-page">
      <section className="dev-hero e-panel">
        <span className="dev-av lg" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>{a.slice(2, 4).toUpperCase()}</span>
        <div className="dev-hero-t">
          <h1 className="num">{short(a)}</h1>
          <p className="dim">{rec ? devRecordLine(rec) : tr("Loading dev history…")}</p>
        </div>
        {rep && (
          <span className={`dev-badge ${rep}`}>
            {rep === "trusted" ? tr("Trusted") : rep === "risky" ? `⚠ ${tr("Risky")}` : rep === "new" ? tr("New dev") : tr("Active dev")}
          </span>
        )}
      </section>

      {rec && rec.launched > 0 && (
        <section className="dev-stats">
          <div><span>{tr("Launched")}</span><b className="num">{rec.launched}</b></div>
          <div><span>{tr("Still live")}</span><b className="num up">{rec.alive}</b></div>
          <div><span>{tr("Went to zero")}</span><b className="num down">{rec.dead}</b></div>
          <div><span>{tr("Biggest")}</span><b className="num">{rec.best ? money(rec.best) : "—"}</b></div>
        </section>
      )}

      <section className="e-panel">
        <h3 className="e-ph">{tr("Coins by this dev")}</h3>
        {!tokens && <div style={{ padding: 14, display: "grid", gap: 10 }}>{Array.from({ length: 4 }, (_, i) => <div key={i} className="e-skel" style={{ height: 48 }} />)}</div>}
        {tokens && !mine.length && <div className="e-empty">{tr("No indexed coins from this dev yet.")}</div>}
        <div className="e-rows">
          {mine.map((t: EToken) => (
            <Link key={t.address} href={`/t/?a=${t.address}`} className="e-row dev-row">
              <span className="e-tok">
                <TokenAvatar t={t} size={36} />
                <span>
                  <span className="l1"><b>{t.name}</b><span className="sym">{t.symbol}</span></span>
                  <small className="dim">{tr("{age} old", { age: ago(t.created_at) })} · {tr("{n} holders", { n: compact(t.holders || 0) })}</small>
                </span>
              </span>
              <span className="e-mc"><b>{money((t.mcap_hype ?? 0) * usd)}</b><span className={`e-pill ${upDown(t.change24)}`}>{pct(t.change24)}</span></span>
            </Link>
          ))}
        </div>
      </section>
      <p className="shield-foot dim" style={{ textAlign: "center" }}>{tr("On-chain history, not advice. Do your own research before buying.")}</p>
    </main>
  );
}
