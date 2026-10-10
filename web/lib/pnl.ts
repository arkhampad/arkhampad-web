"use client";
// A wallet's result on one coin, from its own trades (bought, sold, value still held).
import { db } from "./live";
import type { Pnl } from "./share";

export async function positionPnl(chainId: number, coin: string, wallet: string, meta: { name: string; tick: string; chain: string; image?: string | null; c1: string; c2: string; mcNow: number; heldValue?: number; supply?: number }): Promise<Pnl | null> {
  const { data } = await db().from("trades").select("is_buy,usdc,coins,mc_usd").eq("chain_id", chainId).eq("coin", coin.toLowerCase()).eq("trader", wallet.toLowerCase()).limit(1000);
  const rows = (data ?? []) as { is_buy: boolean; usdc: number; coins: number; mc_usd: number }[];
  const buys = rows.filter((r) => r.is_buy);
  if (!buys.length) return null;
  const bought = buys.reduce((a, r) => a + Number(r.usdc), 0);
  const back = rows.filter((r) => !r.is_buy).reduce((a, r) => a + Number(r.usdc), 0);
  const net = rows.reduce((a, r) => a + (r.is_buy ? Number(r.coins) : -Number(r.coins)), 0);
  const held = meta.heldValue ?? Math.max(0, net) * (meta.mcNow / (meta.supply && meta.supply > 0 ? meta.supply : 1e9));
  const pnl = back + held - bought;
  // average entry market cap, weighted by dollars spent
  const entryMc = buys.reduce((a, r) => a + Number(r.mc_usd) * Number(r.usdc), 0) / bought;
  return { name: meta.name, tick: meta.tick, chain: meta.chain, id: `${chainId}-${coin.toLowerCase()}`, image: meta.image, c1: meta.c1, c2: meta.c2, bought, back: back + held, pnl, pct: (pnl / bought) * 100, entryMc, nowMc: meta.mcNow, closed: net <= 1 };
}
