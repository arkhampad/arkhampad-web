"use client";
// Real trader stats (from on-chain trades), follows and the following feed.
import { useCallback, useEffect, useState } from "react";
import { db, short } from "./live";

export type TraderRow = { trader: string; pnl: number; bought: number; sold: number; volume: number; trades: number; coins: number; wins: number; last_trade: string; followers: number; roi: number; win: number };

const BURN = "0x000000000000000000000000000000000000dead";

export async function board(days: number, limit = 100, trader?: string): Promise<TraderRow[]> {
  const { data, error } = await db().rpc("trader_board", { p_days: days, p_limit: limit, p_exclude: [BURN], p_trader: trader ?? null });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => {
    const n = (k: string) => Number(r[k] ?? 0);
    return { trader: String(r.trader), pnl: n("pnl"), bought: n("bought"), sold: n("sold"), volume: n("volume"), trades: n("trades"), coins: n("coins"), wins: n("wins"), last_trade: String(r.last_trade), followers: n("followers"), roi: n("bought") > 0 ? (n("pnl") / n("bought")) * 100 : 0, win: n("coins") > 0 ? (n("wins") / n("coins")) * 100 : 0 };
  });
}

export async function followingOf(me: string): Promise<string[]> {
  const { data } = await db().from("follows").select("trader").eq("follower", me.toLowerCase()).limit(500);
  return ((data ?? []) as { trader: string }[]).map((r) => r.trader);
}

// one shared "who do I follow" list for the whole site
let cache: { me: string; list: string[] } | null = null;
const subs = new Set<(l: string[]) => void>();
export function setFollowingCache(me: string, list: string[]) { cache = { me: me.toLowerCase(), list }; subs.forEach((f) => f(list)); }
export function useFollowing(me: string | null) {
  const [list, setList] = useState<string[]>(cache && me && cache.me === me.toLowerCase() ? cache.list : []);
  const reload = useCallback(async () => { if (!me) { setList([]); return; } const l = await followingOf(me); setFollowingCache(me, l); }, [me]);
  useEffect(() => { subs.add(setList); reload(); return () => { subs.delete(setList); }; }, [reload]);
  return { following: list, reload };
}

export type FeedTrade = { id: string; trader: string; chainId: number; coin: string; tick: string; name: string; isBuy: boolean; usdc: number; ts: string };
export async function feedOf(traders: string[], limit = 30): Promise<FeedTrade[]> {
  if (!traders.length) return [];
  const { data } = await db().from("trades").select("chain_id,tx_hash,log_index,coin,trader,is_buy,usdc,ts").in("trader", traders.slice(0, 200)).order("ts", { ascending: false }).limit(limit);
  const rows = (data ?? []) as { chain_id: number; tx_hash: string; log_index: number; coin: string; trader: string; is_buy: boolean; usdc: number; ts: string }[];
  const coins = [...new Set(rows.map((r) => r.coin))];
  const { data: names } = coins.length ? await db().from("coins").select("address,symbol,name").in("address", coins) : { data: [] };
  const by = new Map(((names ?? []) as { address: string; symbol: string; name: string }[]).map((c) => [c.address, c]));
  return rows.map((r) => ({ id: `${r.chain_id}-${r.tx_hash}-${r.log_index}`, trader: r.trader, chainId: r.chain_id, coin: r.coin, tick: by.get(r.coin)?.symbol ?? "?", name: by.get(r.coin)?.name ?? short(r.coin), isBuy: r.is_buy, usdc: Number(r.usdc), ts: r.ts }));
}

const COLORS = [["#7C5CFF", "#3A2BFF"], ["#FF8A3D", "#FF3D7F"], ["#2BB3FF", "#0066FF"], ["#E8559A", "#8A2BE2"], ["#3DDC97", "#00B37E"], ["#F5C542", "#FF7A00"]];
export const traderColors = (a: string) => COLORS[parseInt(a.slice(-2), 16) % COLORS.length] || COLORS[0];
export const copyAmount = () => { try { return Number(localStorage.getItem("ap_copy_amt") || 25) || 25; } catch { return 25; } };
export const setCopyAmount = (v: number) => { try { localStorage.setItem("ap_copy_amt", String(v)); } catch { /* storage off */ } };
