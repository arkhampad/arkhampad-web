"use client";
// Safety check for coins launched on ArkhamPad, from real data only:
// on-chain balances (holders, creator share), the creator lock, the coin's age and its trades.
// AI only writes the one-line summary (/api/safety); the score and checks never come from AI.
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { db, type LiveCoin } from "./live";
import { holdersOf, onLocalTrade } from "./chain";

export type Level = 0 | 1 | 2; // low, medium, high
export type Check = { ok: "ok" | "warn" | "bad"; label: string; value: string };
export type Facts = {
  ageMin: number; lockLeftSec: number; lockChosen: boolean; creatorPct: number; top10Pct: number;
  holders: number; buyers: number; trades: number; topBuyersPct: number; graduated: boolean; feeBurn: boolean;
};
export type Safety = { level: Level; checks: Check[]; facts: Facts; summary: string; warn: string | null; holders: { wallet: string; amount: number }[]; unlockAt: number | null };

const SUPPLY = 1e9;
const pct = (n: number) => (n >= 10 ? n.toFixed(1) : n.toFixed(n >= 1 ? 1 : 2)) + "%";
const age = (m: number) => (m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`);

/** Score + plain-English checks. Exported for tests. */
export function assess(f: Facts): { level: Level; checks: Check[]; warn: string | null; summary: string } {
  let score = 0;
  const checks: Check[] = [{ ok: "ok", label: "Fixed supply, nobody can mint more", value: "" }];
  const locked = f.lockLeftSec > 0;
  checks.push({ ok: locked ? "ok" : f.creatorPct > 5 ? "bad" : "warn", label: "Creator lock", value: locked ? "locked" : f.lockChosen ? "ended" : "none" });
  if (!locked && f.creatorPct > 5) score += 1;
  const cBad = f.creatorPct > 20, cWarn = f.creatorPct > 10;
  checks.push({ ok: cBad ? "bad" : cWarn ? "warn" : "ok", label: "Creator holds", value: pct(f.creatorPct) });
  score += cBad ? 2 : cWarn ? 1 : 0;
  if (f.holders > 0) {
    const tBad = f.top10Pct > 60, tWarn = f.top10Pct > 35;
    checks.push({ ok: tBad ? "bad" : tWarn ? "warn" : "ok", label: "Top 10 holders", value: pct(f.top10Pct) });
    score += tBad ? 2 : tWarn ? 1 : 0;
  }
  if (f.trades >= 5 && f.topBuyersPct > 70) {
    checks.push({ ok: "bad", label: "Most buys came from", value: "3 wallets" });
    score += 2;
  } else {
    checks.push({ ok: f.buyers >= 10 ? "ok" : "warn", label: "Different wallets buying", value: String(f.buyers) });
  }
  if (f.graduated) checks.push({ ok: "ok", label: "Graduated, pool locked forever", value: "" });
  else if (f.ageMin < 60) { checks.push({ ok: "warn", label: f.ageMin < 30 ? "Very young coin" : "Young coin, prices move fast", value: age(f.ageMin) }); if (f.ageMin < 30) score += 1; }
  else checks.push({ ok: "ok", label: "Coin age", value: age(f.ageMin) });
  const level: Level = score >= 4 ? 2 : score >= 2 ? 1 : 0;

  // the pre-buy warning names the two biggest reasons, in plain words
  const reasons: string[] = [];
  if (cBad && !locked) reasons.push(`the creator holds ${pct(f.creatorPct)} of the supply with no lock`);
  else if (cBad) reasons.push(`the creator holds ${pct(f.creatorPct)} of the supply`);
  if (f.trades >= 5 && f.topBuyersPct > 70) reasons.push("most buys came from 3 wallets");
  if (f.holders > 0 && f.top10Pct > 60) reasons.push(`the top 10 wallets hold ${pct(f.top10Pct)}`);
  if (!locked && !cBad && f.creatorPct > 5) reasons.push("the creator didn't lock their coins");
  if (f.ageMin < 30 && !f.graduated) reasons.push(`this coin is ${age(f.ageMin)} old`);
  const r2 = reasons.slice(0, 2);
  const joined = r2.length === 2 ? `${r2[0]}, and ${r2[1]}` : r2[0] ?? "";
  const warn = level >= 1 && joined ? `${joined[0].toUpperCase()}${joined.slice(1)}. Only buy what you can afford to lose.` : null;

  const summary = f.trades === 0
    ? `No trades yet. ${locked ? "The creator is locked" : f.lockChosen ? "The creator lock has ended" : "The creator chose no lock"} and holds ${pct(f.creatorPct)}.`
    : level === 0
    ? `${locked ? "The creator is locked and" : "The creator"} holds ${pct(f.creatorPct)}. ${f.buyers} different wallets have bought${f.holders ? ` and the top 10 hold ${pct(f.top10Pct)}` : ""}.`
    : `${joined ? `${joined[0].toUpperCase()}${joined.slice(1)}.` : "A few signs need care."} ${level === 2 ? "One big sell could move the price sharply." : "Early prices can swing hard."}`;
  return { level, checks, warn, summary };
}

type Entry = { at: number; p: Promise<Safety> };
const cache = new Map<string, Entry>();
const TTL = 60_000;

async function build(c: LiveCoin): Promise<Safety> {
  const { data } = await db().from("trades").select("trader,is_buy,usdc").eq("chain_id", c.chainId).eq("coin", c.address.toLowerCase()).limit(2000);
  const trades = (data ?? []) as { trader: string; is_buy: boolean; usdc: number }[];
  const wallets = [...new Set(trades.map((t) => t.trader))];
  const creator = c.creator?.toLowerCase() ?? "";
  if (creator) wallets.push(creator);
  const holders = await holdersOf(c.chainId, c.address as Address, wallets);
  const creatorAmt = holders.find((h) => h.wallet === creator)?.amount ?? 0;
  const top10 = holders.slice(0, 10).reduce((a, h) => a + h.amount, 0);
  const buys = trades.filter((t) => t.is_buy);
  const byWallet = new Map<string, number>();
  for (const t of buys) byWallet.set(t.trader, (byWallet.get(t.trader) ?? 0) + Number(t.usdc));
  const total = [...byWallet.values()].reduce((a, v) => a + v, 0);
  const top3 = [...byWallet.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, v) => a + v, 0);
  const created = c.createdAt ? Date.parse(c.createdAt) : Date.now();
  const unlockAt = c.lockSeconds ? created + c.lockSeconds * 1000 : null;
  const facts: Facts = {
    ageMin: Math.max(0, (Date.now() - created) / 60_000),
    lockLeftSec: unlockAt ? Math.max(0, Math.round((unlockAt - Date.now()) / 1000)) : 0,
    lockChosen: !!c.lockSeconds,
    creatorPct: (creatorAmt / SUPPLY) * 100,
    top10Pct: (top10 / SUPPLY) * 100,
    holders: holders.length,
    buyers: byWallet.size,
    trades: trades.length,
    topBuyersPct: total > 0 && byWallet.size > 3 ? (top3 / total) * 100 : 0,
    graduated: c.phase === 2,
    feeBurn: c.feeMode === 1,
  };
  return { ...assess(facts), facts, holders, unlockAt };
}

/** Cached for a minute, so the coin page, holders list and trade panel share one load. */
export function loadSafety(c: LiveCoin, fresh = false): Promise<Safety> {
  const hit = cache.get(c.id);
  if (hit && !fresh && Date.now() - hit.at < TTL) return hit.p;
  const p = build(c);
  cache.set(c.id, { at: Date.now(), p });
  p.catch(() => cache.delete(c.id));
  return p;
}

export function useSafety(c: LiveCoin | null | undefined): Safety | null {
  const [s, setS] = useState<Safety | null>(null);
  useEffect(() => {
    if (!c || !c.own) { setS(null); return; }
    let alive = true;
    setS(null);
    const run = (fresh: boolean) => loadSafety(c, fresh).then((v) => { if (alive) setS(v); }).catch(() => {});
    run(false);
    const off = onLocalTrade((t) => { if (t.coin.toLowerCase() === c.address.toLowerCase()) setTimeout(() => run(true), 900); });
    const iv = setInterval(() => run(true), 90_000);
    return () => { alive = false; off(); clearInterval(iv); };
  }, [c?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

const lines = new Map<string, Promise<string | null>>();
/** One AI sentence from the facts; null when AI is unavailable (the template summary is used). */
export function aiLine(id: string, s: Safety): Promise<string | null> {
  const key = `${id}|${s.level}|${Math.round(s.facts.creatorPct)}|${Math.round(s.facts.top10Pct)}|${s.facts.buyers}|${s.facts.lockLeftSec > 0}`;
  let p = lines.get(key);
  if (!p) {
    p = fetch("/api/safety", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ facts: s.facts, level: s.level }) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => (j && typeof j.text === "string" && j.text.length > 20 ? j.text : null)).catch(() => null);
    lines.set(key, p);
  }
  return p;
}
