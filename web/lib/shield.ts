"use client";
// Shield — anti-rug safety score + dev reputation, from data the app already has (ely_tokens, ely_trades,
// the on-chain sellable check in lib/elytrade). Scoring mirrors the thresholds in the legacy lib/safety.ts
// (creator/top-10 concentration, honeypot, age) rather than importing it, so the ely bundle stays free of
// the old Supabase/chain stack. Honest and data-only: no AI, no fabricated history, no paid sources.
import { useEffect, useState } from "react";
import { fetchTokens, fetchTrades, money, usePoll, type EToken, type ETrade } from "./ely";
import { sellable, taxedTokens } from "./elytrade";

export type ShieldLevel = "green" | "amber" | "red";
export type ShieldCheck = { ok: "ok" | "warn" | "bad" | "unknown"; label: string; value: string };
export type Shield = { level: ShieldLevel; checks: ShieldCheck[]; flags: string[] };

const lc = (a: string | null | undefined) => (a ? a.toLowerCase() : "");
const pct = (n: number) => `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;

/** Build the per-coin safety verdict. `sell` is the async honeypot check result (null = couldn't check). */
export function assessShield(t: EToken, trades: ETrade[] | null | undefined, usd: number, sell: boolean | null): Shield {
  const checks: ShieldCheck[] = [];
  const flags: string[] = [];
  let score = 0;
  let red = false;

  // liquidity locked — ArkhamPad's launcher locks LP forever; other pads we can't confirm here
  if (t.ours) checks.push({ ok: "ok", label: "Liquidity locked", value: "Forever" });
  else checks.push({ ok: "unknown", label: "Liquidity lock", value: "Not verified" });

  // mint — ArkhamPad coins have a fixed supply (no mint); elsewhere we don't hold the authority data
  if (t.ours) checks.push({ ok: "ok", label: "Fixed supply, no new mint", value: "" });
  else checks.push({ ok: "unknown", label: "Dev can mint more", value: "Not verified" });

  // honeypot / sellable
  const taxed = taxedTokens.has(lc(t.address));
  if (t.ours || sell === true) checks.push({ ok: taxed ? "warn" : "ok", label: "Sellable", value: taxed ? "Takes a trade tax" : "Yes" });
  else if (sell === false) { checks.push({ ok: "bad", label: "Sellable", value: "Blocked (honeypot risk)" }); red = true; flags.push("May not be sellable"); }
  else checks.push({ ok: "unknown", label: "Sellable", value: "Checking…" });
  if (taxed) { score += 1; flags.push("Trade tax"); }

  // top-10 holder concentration
  if (t.top10_pct != null) {
    const top10 = Math.min(100, t.top10_pct);
    const bad = top10 > 60, warn = top10 > 35;
    checks.push({ ok: bad ? "bad" : warn ? "warn" : "ok", label: "Top 10 hold", value: pct(top10) });
    score += bad ? 2 : warn ? 1 : 0;
    if (bad) flags.push(`Top 10 hold ${pct(top10)}`);
  }

  // is the dev selling right now? (creator sells in the last hour)
  const dev = lc(t.creator);
  const mcapHype = t.mcap_hype ?? 0;
  if (dev && trades && trades.length) {
    const cut = Date.now() - 60 * 60_000;
    const devSells = trades.filter((x) => x.side === "sell" && lc(x.trader) === dev && Date.parse(x.at) >= cut);
    const sold = devSells.reduce((a, x) => a + (x.hype || 0), 0);
    if (devSells.length) {
      const bigDump = mcapHype > 0 && sold >= 0.01 * mcapHype; // sold >= 1% of market cap
      checks.push({ ok: bigDump ? "bad" : "warn", label: "Dev is selling", value: money(sold * (usd || 0)) });
      score += bigDump ? 2 : 1;
      flags.push(bigDump ? "Dev is dumping" : "Dev sold recently");
      if (bigDump) red = true;
    } else checks.push({ ok: "ok", label: "Dev not selling", value: "" });
  }

  // young coin — prices swing hard early
  const ageMin = t.created_at ? (Date.now() - Date.parse(t.created_at)) / 60_000 : Infinity;
  if (ageMin < 30) { checks.push({ ok: "warn", label: "Very young coin", value: `${Math.max(1, Math.round(ageMin))}m` }); score += 1; }

  const level: ShieldLevel = red || score >= 4 ? "red" : score >= 2 ? "amber" : "green";
  return { level, checks, flags };
}

/** The per-coin Shield, kept live. Runs the sellable check once (cached in elytrade) for non-own coins. */
export function useShield(token: EToken | null | undefined, trades: ETrade[] | null | undefined, usd: number): Shield | null {
  const sell = usePoll(async () => (token && !token.ours ? sellable(token).catch(() => null) : null), 600_000, [token?.address, token?.ours]);
  const [s, setS] = useState<Shield | null>(null);
  useEffect(() => {
    if (!token) { setS(null); return; }
    setS(assessShield(token, trades, usd, sell ?? null));
  }, [token, trades, usd, sell]);
  return s;
}

// ---- dev reputation ----------------------------------------------------------------------------
export type DevRep = "trusted" | "new" | "risky" | "normal";
export type DevRecord = { dev: string; launched: number; dead: number; alive: number; best: number; rep: DevRep };

const mcUsd = (t: EToken, usd: number) => (t.mcap_hype ?? 0) * (usd || 0);
/** A coin counts as "went to zero" only on clear, old evidence (conservative, to avoid false alarms). */
function isDead(t: EToken, usd: number): boolean {
  const ageH = t.created_at ? (Date.now() - Date.parse(t.created_at)) / 3_600_000 : 0;
  if (ageH < 6) return false;
  const mc = mcUsd(t, usd);
  if (usd > 0 && mc > 1500) return false; // still has real value
  const quiet = !t.last_trade_at || Date.now() - Date.parse(t.last_trade_at) > 24 * 3_600_000;
  const crashed = (t.change24 ?? 0) <= -60;
  return (usd > 0 && mc < 800 && (crashed || quiet)) || (quiet && (t.holders || 0) <= 3);
}

/** Reputation from a dev's own coins. */
function recordFromMine(dev: string, mine: EToken[], usd: number): DevRecord {
  let dead = 0, alive = 0, best = 0;
  for (const t of mine) {
    const mc = mcUsd(t, usd);
    if (mc > best) best = mc;
    if (isDead(t, usd)) dead++;
    else if ((t.holders || 0) >= 5 || mc >= 2000) alive++;
  }
  const launched = mine.length;
  let rep: DevRep = "normal";
  if (dead >= 2) rep = "risky";
  else if (launched <= 1) rep = "new";
  else if (launched >= 3 && dead === 0 && alive >= 2) rep = "trusted";
  return { dev: lc(dev), launched, dead, alive, best, rep };
}

/** A dev's launch record, computed from the tokens list already in hand (no extra fetch). */
export function devRecordFromTokens(dev: string, tokens: EToken[], usd: number): DevRecord {
  const d = lc(dev);
  return recordFromMine(d, tokens.filter((t) => lc(t.creator) === d), usd);
}

/** Reputation for every dev in one pass — for Discover, where the whole tokens list is already loaded. */
export function devRepsFromTokens(tokens: EToken[], usd: number): Map<string, DevRep> {
  const byCreator = new Map<string, EToken[]>();
  for (const t of tokens) {
    const c = lc(t.creator);
    if (!c) continue;
    const list = byCreator.get(c);
    if (list) list.push(t); else byCreator.set(c, [t]);
  }
  const out = new Map<string, DevRep>();
  for (const [c, mine] of byCreator) out.set(c, recordFromMine(c, mine, usd).rep);
  return out;
}

/** One short, honest line describing the record. */
export function devRecordLine(r: DevRecord): string {
  if (!r.launched) return "No other coins from this dev";
  const base = `${r.launched} coin${r.launched === 1 ? "" : "s"} launched`;
  if (r.dead > 0) return `${base} · ${r.dead} went to zero`;
  if (r.best > 0) return `${base} · biggest ${money(r.best)}`;
  return base;
}

/** The dev record for the coin page, fetching the tokens list once (edge-cached, shared with Discover). */
export function useDevRecord(dev: string | null | undefined, usd: number): DevRecord | null {
  const tokens = usePoll(fetchTokens, 120_000);
  const [r, setR] = useState<DevRecord | null>(null);
  useEffect(() => {
    if (!dev || !tokens) { setR(null); return; }
    setR(devRecordFromTokens(dev, tokens, usd));
  }, [dev, tokens, usd]);
  return r;
}
