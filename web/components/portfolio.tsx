"use client";
// AI portfolio summary on Profile: numbers from your own trades, AI turns them into plain words.
import { useEffect, useMemo, useState } from "react";
import { db, usd, type LiveCoin } from "@/lib/live";
import { ISpark } from "./icons";

type Holding = { coin: LiveCoin; amount: number; value: number };
type Row = { chain_id: number; coin: string; is_buy: boolean; usdc: number };
export type PortfolioFacts = {
  value: number; invested: number; result: number; resultPct: number; coins: number; winners: number;
  best: { tick: string; pct: number } | null; worst: { tick: string; pct: number } | null;
  young: number; bonding: number; graduated: number; // share of money, %
};

export function portfolioFacts(holdings: Holding[], trades: Row[]): PortfolioFacts | null {
  if (!holdings.length) return null;
  const per = holdings.map((h) => {
    const mine = trades.filter((t) => t.chain_id === h.coin.chainId && t.coin === h.coin.address.toLowerCase());
    const paid = mine.filter((t) => t.is_buy).reduce((a, t) => a + Number(t.usdc), 0);
    const back = mine.filter((t) => !t.is_buy).reduce((a, t) => a + Number(t.usdc), 0);
    const result = back + h.value - paid;
    return { h, paid, result, pct: paid > 0 ? (result / paid) * 100 : 0 };
  });
  const value = holdings.reduce((a, h) => a + h.value, 0);
  const invested = per.reduce((a, p) => a + p.paid, 0);
  const result = per.reduce((a, p) => a + p.result, 0);
  const ranked = per.filter((p) => p.paid > 0).sort((a, b) => b.pct - a.pct);
  const hour = Date.now() - 3600_000;
  const share = (pred: (h: Holding) => boolean) => (value > 0 ? Math.round((holdings.filter(pred).reduce((a, h) => a + h.value, 0) / value) * 100) : 0);
  const young = share((h) => !!h.coin.createdAt && Date.parse(h.coin.createdAt) > hour);
  const graduated = share((h) => h.coin.phase === 2);
  return {
    value, invested, result, resultPct: invested > 0 ? (result / invested) * 100 : 0, coins: holdings.length,
    winners: per.filter((p) => p.result > 0).length,
    best: ranked[0] ? { tick: ranked[0].h.coin.tick, pct: Math.round(ranked[0].pct) } : null,
    worst: ranked.length > 1 ? { tick: ranked[ranked.length - 1].h.coin.tick, pct: Math.round(ranked[ranked.length - 1].pct) } : null,
    young, graduated, bonding: Math.max(0, 100 - graduated),
  };
}

/** Plain summary from the numbers, used until (or instead of) the AI one. */
export function plainSummary(f: PortfolioFacts): string {
  const sign = f.result >= 0 ? "up" : "down";
  const parts = [`You're ${sign} ${usd(Math.abs(f.result))} (${f.resultPct >= 0 ? "+" : ""}${f.resultPct.toFixed(0)}%) across ${f.coins} coin${f.coins === 1 ? "" : "s"}, with ${f.winners} in profit.`];
  if (f.best && f.best.pct > 0) parts.push(`$${f.best.tick} is your best at ${f.best.pct >= 0 ? "+" : ""}${f.best.pct}%.`);
  if (f.young >= 50) parts.push(`Worth noticing: ${f.young}% of your money is in coins less than an hour old, which can swing hard.`);
  else if (f.worst && f.worst.pct < -20) parts.push(`Worth noticing: $${f.worst.tick} is down ${Math.abs(f.worst.pct)}%.`);
  return parts.join(" ");
}

export function PortfolioCard({ holdings, me }: { holdings: Holding[]; me: string }) {
  const [trades, setTrades] = useState<Row[] | null>(null);
  const [ai, setAi] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  const sig = holdings.map((h) => `${h.coin.id}:${h.amount.toFixed(0)}`).join(",");
  useEffect(() => {
    let alive = true;
    db().from("trades").select("chain_id,coin,is_buy,usdc").eq("trader", me.toLowerCase()).limit(2000)
      .then(({ data }) => { if (alive) setTrades((data ?? []) as Row[]); }, () => { if (alive) setTrades([]); });
    return () => { alive = false; };
  }, [me, sig]);
  const facts = useMemo(() => (trades ? portfolioFacts(holdings, trades) : null), [trades, holdings]);
  useEffect(() => {
    if (!facts) return;
    let alive = true;
    setBusy(true);
    fetch("/api/portfolio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ facts, variant: n }) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setAi(j && typeof j.text === "string" ? j.text : null); })
      .catch(() => { if (alive) setAi(null); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [facts?.coins, Math.round(facts?.result ?? 0), n]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!holdings.length) return null;
  if (!facts) return <div className="skel" style={{ height: 150, borderRadius: 20 }} />;
  const up = facts.result >= 0;
  return (
    <section className="card" aria-label="Portfolio summary" style={{ gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <b>Your portfolio</b>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setN((v) => v + 1)} aria-label="Write the summary again">{busy ? "Writing…" : "↻ Refresh"}</button>
      </div>
      <div className="ai-note"><ISpark size={16} color="var(--volt-ink)" style={{ flex: "none", marginTop: 2 }} /><span>{ai ?? plainSummary(facts)}</span></div>
      <div className="pstats">
        <div><span className="dim">Coins value</span><b className="mono">{usd(facts.value)}</b></div>
        <div><span className="dim">Result</span><b className={`mono ${up ? "up" : "down"}`}>{up ? "+" : "-"}{usd(Math.abs(facts.result))}</b></div>
        <div><span className="dim">In profit</span><b className="mono">{facts.winners} of {facts.coins}</b></div>
      </div>
      <span style={{ fontSize: 12 }} className="dim">Where your money is</span>
      <div className="spread" aria-hidden="true">
        {facts.young > 0 && <span style={{ flex: facts.young, background: "var(--down)" }} />}
        {facts.bonding - facts.young > 0 && <span style={{ flex: facts.bonding - facts.young, background: "var(--warn)" }} />}
        {facts.graduated > 0 && <span style={{ flex: facts.graduated, background: "var(--up)" }} />}
      </div>
      <div className="legend">
        <span><i style={{ background: "var(--down)" }} />Under 1 hour old · {facts.young}%</span>
        <span><i style={{ background: "var(--warn)" }} />Bonding curve · {Math.max(0, facts.bonding - facts.young)}%</span>
        <span><i style={{ background: "var(--up)" }} />Graduated · {facts.graduated}%</span>
      </div>
    </section>
  );
}
