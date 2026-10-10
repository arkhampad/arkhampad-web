"use client";
// Holder map data: who holds a coin, and which wallets are linked (token transfers between
// them, or buying together in the same block right after launch).
import { db, type LiveCoin } from "./live";
import { NETS } from "./chain";

export type Group = "pool" | "creator" | "linked" | "bundle" | "solo";
export type Holder = {
  w: string; pct: number; bought: number; sold: number; firstTs: string | null;
  group: Group; cluster: number; color: string | null; label: string; early: boolean; creator: boolean;
};
export type Link = { a: string; b: string; amount: number; n: number };
export type Cluster = { id: number; group: Group; color: string; label: string; size: number; pct: number };
export type HolderMap = { holders: Holder[]; links: Link[]; clusters: Cluster[]; total: number; earlyBuyers: number; fromTransfers: boolean };

const PALETTE = ["#F6465D", "#8B5CF6", "#06B6D4", "#EC4899", "#14B8A6", "#F97316"];
export const POOL_COLOR = "#3B82F6";
export const CREATOR_COLOR = "#F59E0B";

type Raw = {
  curve: string; creator: string; phase: number; launch_ts: string | null; from_transfers: boolean; holders_total: number;
  holders: { w: string; bal: number; bought: number; sold: number; first_ts: string | null; first_block: number | null }[];
  links: { a: string; b: string; amount: number; n: number }[];
};

/** false = nothing to show (not our coin, or the lookup failed); null is "still loading" in useLive. */
export async function loadHolderMap(c: LiveCoin): Promise<HolderMap | false> {
  if (!c.own || !c.address) return false;
  const net = NETS.find((n) => n.id === c.chainId);
  const exclude = net ? [net.hub, net.router].map((a) => a.toLowerCase()) : [];
  const { data, error } = await db().rpc("coin_holder_graph", { p_chain: c.chainId, p_coin: c.address.toLowerCase(), p_exclude: exclude });
  if (error || !data) return false;
  return build(data as Raw, c.supply && c.supply > 0 ? c.supply : 1e9);
}

function build(r: Raw, SUPPLY: number): HolderMap {
  const curve = (r.curve || "").toLowerCase(), creator = (r.creator || "").toLowerCase();
  const launch = r.launch_ts ? Date.parse(r.launch_ts) : 0;
  const rows = r.holders.map((h) => ({ ...h, w: h.w.toLowerCase(), pct: (Number(h.bal) / SUPPLY) * 100 }));
  // pools: the bonding curve, and after graduation the DEX pool (the largest other holder)
  const pools = new Set<string>([curve]);
  if (r.phase === 2) { const big = rows.find((h) => h.w !== curve && h.pct > 10); if (big) pools.add(big.w); }

  // union-find over wallets that are linked
  const parent = new Map<string, string>();
  const find = (a: string): string => { let p = parent.get(a) ?? a; if (p !== a) { p = find(p); parent.set(a, p); } return p; };
  const join = (a: string, b: string) => { const x = find(a), y = find(b); if (x !== y) parent.set(x, y); };
  const inMap = new Set(rows.map((h) => h.w));
  const links = r.links.map((l) => ({ a: l.a.toLowerCase(), b: l.b.toLowerCase(), amount: Number(l.amount), n: Number(l.n) }))
    .filter((l) => inMap.has(l.a) && inMap.has(l.b) && !pools.has(l.a) && !pools.has(l.b));
  for (const l of links) join(l.a, l.b);
  // same block, first minute: bought together right after launch (3+ wallets)
  const early = (h: (typeof rows)[number]) => !!(h.first_ts && launch && Date.parse(h.first_ts) - launch <= 60_000);
  const byBlock = new Map<number, string[]>();
  for (const h of rows) if (early(h) && h.first_block != null && !pools.has(h.w)) byBlock.set(h.first_block, [...(byBlock.get(h.first_block) ?? []), h.w]);
  const bundled = new Set<string>();
  for (const ws of byBlock.values()) if (ws.length >= 3) { for (const w of ws) { join(ws[0], w); bundled.add(w); } }

  // groups
  const members = new Map<string, string[]>();
  for (const h of rows) { if (pools.has(h.w)) continue; const k = find(h.w); members.set(k, [...(members.get(k) ?? []), h.w]); }
  const creatorRoot = inMap.has(creator) ? find(creator) : null;
  const clusters: Cluster[] = [];
  const clusterOf = new Map<string, Cluster>();
  let ci = 0;
  const pctOf = new Map(rows.map((h) => [h.w, h.pct]));
  for (const [root, ws] of [...members.entries()].sort((a, b) => sum(b[1]) - sum(a[1]))) {
    const isCreator = root === creatorRoot;
    if (ws.length < 2 && !isCreator) continue;
    const linkedByTransfer = ws.some((w) => links.some((l) => l.a === w || l.b === w));
    const group: Group = isCreator ? "creator" : linkedByTransfer ? "linked" : "bundle";
    const cl: Cluster = { id: ++ci, group, color: isCreator ? CREATOR_COLOR : PALETTE[(clusters.filter((x) => x.group !== "creator").length) % PALETTE.length], label: isCreator ? "Creator group" : group === "linked" ? "Linked by transfers" : "Same-block buyers", size: ws.length, pct: sum(ws) };
    clusters.push(cl);
    for (const w of ws) clusterOf.set(w, cl);
  }
  function sum(ws: string[]) { return ws.reduce((s, w) => s + (pctOf.get(w) ?? 0), 0); }

  const holders: Holder[] = rows.map((h) => {
    const pool = pools.has(h.w), cl = clusterOf.get(h.w);
    return {
      w: h.w, pct: h.pct, bought: Number(h.bought), sold: Number(h.sold), firstTs: h.first_ts,
      group: pool ? "pool" : cl ? cl.group : "solo", cluster: cl?.id ?? 0,
      color: pool ? POOL_COLOR : cl?.color ?? null,
      label: pool ? (h.w === curve ? "Bonding curve" : "DEX pool") : h.w === creator ? "Creator" : cl?.label ?? "",
      early: early(h), creator: h.w === creator,
    };
  });
  return { holders, links, clusters, total: Number(r.holders_total) || holders.length, earlyBuyers: rows.filter(early).length, fromTransfers: !!r.from_transfers };
}

/** Organic disk layout: pools in the middle, independent holders on a golden-angle spiral, clusters as tight groups. */
export function layout(m: HolderMap, W: number, H: number) {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.46;
  const rad = (h: Holder) => (h.group === "pool" ? 14 + Math.sqrt(h.pct) * 6 : 3.5 + Math.sqrt(h.pct) * 7.5);
  const nodes = m.holders.map((h) => ({ h, r: Math.min(rad(h), R * (h.group === "pool" ? 0.15 : 0.12)), x: cx, y: cy, tx: cx, ty: cy }));
  const pools = nodes.filter((n) => n.h.group === "pool");
  pools.forEach((n, i) => { n.tx = cx + (i ? n.r + pools[0].r + 6 : 0); n.ty = cy; });
  const solo = nodes.filter((n) => n.h.group === "solo").sort((a, b) => b.h.pct - a.h.pct);
  const k0 = 14, c = R / Math.sqrt(solo.length + k0 + 1);
  solo.forEach((n, i) => { const k = i + k0, a = k * 2.39996323, d = c * Math.sqrt(k); n.tx = cx + Math.cos(a) * d; n.ty = cy + Math.sin(a) * d; });
  m.clusters.forEach((cl, i) => {
    const ang = -2.35 + i * 2.1, ax = cx + Math.cos(ang) * R * 0.52, ay = cy + Math.sin(ang) * R * 0.52;
    nodes.filter((n) => n.h.cluster === cl.id).forEach((n, j) => { const a = j * 2.39996323, d = 11 * Math.sqrt(j); n.tx = ax + Math.cos(a) * d; n.ty = ay + Math.sin(a) * d; });
  });
  nodes.forEach((n) => { n.x = n.tx; n.y = n.ty; });
  for (let it = 0; it < 140; it++) {
    for (const n of nodes) { n.x += (n.tx - n.x) * 0.06; n.y += (n.ty - n.y) * 0.06; }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const p = nodes[i], q = nodes[j], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1, mn = p.r + q.r + 2.5;
      if (d < mn) { const t = ((mn - d) / d) * 0.5, wp = p.h.group === "pool" ? 0 : 1, wq = q.h.group === "pool" ? 0 : 1; p.x -= dx * t * wp; p.y -= dy * t * wp; q.x += dx * t * wq; q.y += dy * t * wq; }
    }
    for (const n of nodes) { n.x = Math.max(n.r + 2, Math.min(W - n.r - 2, n.x)); n.y = Math.max(n.r + 2, Math.min(H - n.r - 2, n.y)); }
  }
  return nodes;
}
