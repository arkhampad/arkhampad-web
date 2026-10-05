"use client";
// Real platform numbers for Analytics and Daily, invites, and coin comments.
import { db } from "./live";

export type Stats = { coins_total: number; coins_24h: number; graduated: number; volume_24h: number; volume_7d: number; volume_all: number; trades_24h: number; trades_all: number; traders_24h: number; traders_all: number; fees_all: number };
export async function platformStats(): Promise<Stats | null> {
  const { data } = await db().rpc("platform_stats");
  const r = (data as Record<string, unknown>[] | null)?.[0];
  if (!r) return null;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])) as Stats;
}

export type Day = { day: string; volume: number; trades: number; traders: number; launches: number; graduations: number };
export async function dailySeries(days = 30): Promise<Day[]> {
  const { data } = await db().rpc("daily_series", { p_days: days });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ day: String(r.day), volume: Number(r.volume), trades: Number(r.trades), traders: Number(r.traders), launches: Number(r.launches), graduations: Number(r.graduations) }));
}

export type RecapCoin = { chain_id: number; coin: string; symbol: string; name: string; image_url: string | null; change?: number; vol?: number; n?: number; mc_usd: number };
export type Recap = { day: string; volume: number; trades: number; traders: number; launches: number; graduations: number; fastest_grad_s: number | null; gainer: RecapCoin | null; top_volume: RecapCoin | null; biggest_trade: { trader: string; usdc: number; is_buy: boolean; symbol: string; chain_id: number; coin: string } | null; top: RecapCoin[] };
export async function dayRecap(day?: string): Promise<Recap | null> {
  const { data } = await db().rpc("day_recap", { p_day: day ?? null });
  return (data as Recap) ?? null;
}

export type RefRow = { chain_id: number; friends: number; volume: number; earned: number; paid: number };
export async function refEarnings(me: string): Promise<RefRow[]> {
  const { data } = await db().rpc("ref_earnings", { p_referrer: me.toLowerCase() });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ chain_id: Number(r.chain_id), friends: Number(r.friends), volume: Number(r.volume), earned: Number(r.earned), paid: Number(r.paid) }));
}
export async function friendsCount(me: string): Promise<number> {
  const { count } = await db().from("referrals").select("user", { count: "exact", head: true }).eq("referrer", me.toLowerCase());
  return count ?? 0;
}

export type Comment = { id: string; user: string; body: string; holder_pct: number | null; created_at: string; hidden: boolean; hidden_reason: string | null };
export async function commentsOf(chainId: number, coin: string): Promise<Comment[]> {
  const { data } = await db().from("comments").select("id,user,body,holder_pct,created_at,hidden,hidden_reason").eq("chain_id", chainId).eq("coin", coin.toLowerCase()).order("created_at", { ascending: false }).limit(60);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: String(r.id), user: String(r.user), body: String(r.body), holder_pct: r.holder_pct == null ? null : Number(r.holder_pct), created_at: String(r.created_at), hidden: r.hidden === true, hidden_reason: r.hidden_reason == null ? null : String(r.hidden_reason) }));
}

const translations = new Map<string, Promise<{ text: string; from: string } | null>>();
/** Translates a comment into the visitor's language (cached here and at the edge). */
export function translate(text: string, to: string): Promise<{ text: string; from: string } | null> {
  const key = `${to}|${text}`;
  let p = translations.get(key);
  if (!p) {
    p = fetch("/api/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, to }) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => (j && typeof j.text === "string" ? { text: j.text, from: String(j.from || "") } : null)).catch(() => null);
    translations.set(key, p);
    p.then((v) => { if (!v) translations.delete(key); });
  }
  return p;
}
