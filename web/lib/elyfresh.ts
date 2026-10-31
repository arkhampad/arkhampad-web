"use client";
// A coin's first minutes, read straight from the chain. The indexer catches new trades and holders up to
// a couple of minutes late; for a young coin the page reads the pool's swaps and the coin's transfers
// from the nodes itself (every few seconds), so the chart, trades, holders and stats show at once.
import type { EHolder, ETrade, EToken } from "./ely";
import { elyRpc } from "./elytrade";

const SWAP = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"; // Uniswap v3 Swap
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const FRESH_MS = 30 * 60_000;

type Log = { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string; logIndex: string };

/** Young enough (or quiet enough in the index) that the chain is the better source right now. */
export const isFresh = (t: EToken) => {
  const age = t.created_at ? Date.now() - Date.parse(t.created_at) : 0;
  return t.venue === "v3" && !!t.pool && /^0x[0-9a-f]{40}$/i.test(t.pool) && age < FRESH_MS;
};

const signed = (h: string) => { const v = BigInt(`0x${h}`); return v >= 1n << 255n ? v - (1n << 256n) : v; };
const word = (data: string, i: number) => data.slice(2 + i * 64, 2 + (i + 1) * 64);

async function fromBlock(t: EToken): Promise<number> {
  const head = Number(BigInt(await elyRpc<string>("eth_blockNumber", [])));
  const born = Number((t as unknown as { created_block?: number | string | null }).created_block ?? 0);
  return born > 0 && head - born < 200_000 ? Math.max(0, born - 2) : Math.max(0, head - 20_000);
}
async function logs(filter: Record<string, unknown>, from: number): Promise<Log[]> {
  try {
    return await elyRpc<Log[]>("eth_getLogs", [{ ...filter, fromBlock: `0x${from.toString(16)}`, toBlock: "latest" }]);
  } catch {
    // a node that limits the range: the last few thousand blocks are enough for a coin this young
    const head = Number(BigInt(await elyRpc<string>("eth_blockNumber", [])));
    return elyRpc<Log[]>("eth_getLogs", [{ ...filter, fromBlock: `0x${Math.max(from, head - 3000).toString(16)}`, toBlock: "latest" }]);
  }
}

const memo = new Map<string, { at: number; trades: ETrade[]; holders: EHolder[] }>();
const blockTime = new Map<number, number>();
const txFrom = new Map<string, string>();

/** Trades and holders of a young v3 coin, from the nodes. Cached for 3 seconds. */
export async function chainActivity(t: EToken): Promise<{ trades: ETrade[]; holders: EHolder[] }> {
  const k = t.address.toLowerCase();
  const hit = memo.get(k);
  if (hit && Date.now() - hit.at < 3000) return hit;
  const from = await fromBlock(t);
  const [swaps, moves] = await Promise.all([
    logs({ address: t.pool, topics: [SWAP] }, from),
    logs({ address: t.address, topics: [TRANSFER] }, from),
  ]);
  const dec = 10 ** (t.decimals ?? 18);

  // when each block happened, and who sent each trade (a handful of reads for a young coin)
  const blocks = [...new Set(swaps.map((l) => Number(BigInt(l.blockNumber))))].filter((b) => !blockTime.has(b)).slice(-40);
  const hashes = [...new Set(swaps.map((l) => l.transactionHash))].filter((h) => !txFrom.has(h)).slice(-40);
  await Promise.all([
    ...blocks.map(async (b) => { const x = await elyRpc<{ timestamp: string } | null>("eth_getBlockByNumber", [`0x${b.toString(16)}`, false]).catch(() => null); if (x) blockTime.set(b, Number(BigInt(x.timestamp)) * 1000); }),
    ...hashes.map(async (h) => { const x = await elyRpc<{ from: string } | null>("eth_getTransactionByHash", [h]).catch(() => null); if (x?.from) txFrom.set(h, x.from.toLowerCase()); }),
  ]);

  const trades: ETrade[] = swaps.map((l) => {
    const a0 = signed(word(l.data, 0));
    const a1 = signed(word(l.data, 1));
    const coin = t.token_is0 ? a0 : a1;
    const hype = t.token_is0 ? a1 : a0;
    const amount = Math.abs(Number(coin)) / dec;
    const h = Math.abs(Number(hype)) / 1e18;
    const b = Number(BigInt(l.blockNumber));
    return {
      token: k,
      tx: l.transactionHash,
      log_index: Number(BigInt(l.logIndex)),
      at: new Date(blockTime.get(b) ?? Date.now()).toISOString(),
      side: coin < 0n ? "buy" : "sell", // coins leaving the pool = someone bought
      hype: h,
      amount,
      price_hype: amount > 0 ? h / amount : null,
      trader: txFrom.get(l.transactionHash) ?? null,
    } as ETrade;
  }).sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : y.log_index - x.log_index));

  // balances from every transfer since the coin was made
  const bal = new Map<string, bigint>();
  const ZERO = "0x0000000000000000000000000000000000000000";
  for (const l of moves) {
    const f = `0x${l.topics[1].slice(26)}`.toLowerCase();
    const to = `0x${l.topics[2].slice(26)}`.toLowerCase();
    const v = BigInt(l.data);
    if (f !== ZERO) bal.set(f, (bal.get(f) ?? 0n) - v);
    if (to !== ZERO) bal.set(to, (bal.get(to) ?? 0n) + v);
  }
  const holders: EHolder[] = [...bal.entries()].filter(([, v]) => v > 0n).sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0)).map(([holder, v]) => ({ holder, amount: v.toString() }));

  const out = { at: Date.now(), trades, holders };
  memo.set(k, out);
  return out;
}

/** The index's trades plus anything the chain has that the index doesn't yet, newest first. */
export function mergeTrades(db: ETrade[] | undefined, chain: ETrade[] | undefined | null): ETrade[] | undefined {
  if (!chain?.length) return db;
  const seen = new Set((db ?? []).map((x) => `${x.tx.toLowerCase()}-${x.log_index}`));
  const extra = chain.filter((x) => !seen.has(`${x.tx.toLowerCase()}-${x.log_index}`));
  if (!extra.length) return db;
  return [...extra, ...(db ?? [])].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
}
