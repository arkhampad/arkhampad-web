"use client";
// ArkhamPad airdrop points: the leaderboard and one wallet's standing, from db/030_ely_points.sql.
// Points reward real activity on ArkhamPad — trading volume (in HYPE) + coins launched — with a 2x
// multiplier for Genesis NFT holders. Read-only; the numbers come straight from on-chain trades.
import { db } from "./live";

export type PointRow = {
  wallet: string;
  volume: number;   // total HYPE traded (buys + sells)
  trades: number;
  launches: number;
  genesis: boolean;
  points: number;
  rank: number;
};

function row(r: Record<string, unknown>): PointRow {
  const n = (k: string) => Number(r[k] ?? 0);
  return { wallet: String(r.wallet), volume: n("volume"), trades: n("trades"), launches: n("launches"), genesis: Boolean(r.genesis), points: n("points"), rank: n("rank") };
}

/** Top wallets by points. */
export async function board(limit = 100): Promise<PointRow[]> {
  const { data, error } = await db().rpc("ely_points", { p_limit: limit, p_wallet: null });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(row);
}

/** One wallet's own points and global rank (null if it has no activity yet). */
export async function myPoints(wallet: string): Promise<PointRow | null> {
  const { data, error } = await db().rpc("ely_points", { p_limit: 1, p_wallet: wallet.toLowerCase() });
  if (error || !data) return null;
  const r = (data as Record<string, unknown>[])[0];
  return r ? row(r) : null;
}
