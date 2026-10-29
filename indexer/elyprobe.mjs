// Elysium mainnet probe, part 2: find the official (canonical) bridge on HyperEVM.
// Elysium is an Arbitrum Orbit chain settling on HyperEVM, so HYPE deposits go through an Orbit
// Inbox/Bridge contract on HyperEVM. We find recent deposits on Elysium, then look on HyperEVM, at
// those moments, for the Orbit "message delivered" events: whoever emits them is the bridge.
// Read-only public chain data. Adds a "bridge" section to indexer/ely-mainnet.json.
//
//   node elyprobe.mjs [elysium rpc]

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const ELY = process.argv[2] || process.env.ELY_RPC || "https://rpc-live.boxa.club";
const HEVM = process.env.HYPEREVM_RPC || "https://rpc.hyperliquid.xyz/evm";
const TOPICS = {
  inboxMessageDelivered: "0xff64905f73a67fb594e0f940a8075a860db489ad991e032f48c81123eb52d60b",
  inboxMessageFromOrigin: "0xab532385be8f1005a4b6ba8fa20a2245facb346134ac739fe9a5198dc1580b9c",
  bridgeMessageDelivered: "0x5e3c1311ea442664e8b1611bfabef659120ea7a0a2cfc0667700bebc69cbffe1",
};
const DEPOSIT_TYPES = new Set(["0x64", "0x68", "0x69"]); // Arbitrum deposit / retry / submit-retryable

let id = 0;
async function call(url, method, params = []) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(20_000) });
      const j = await r.json();
      if (j.error) throw new Error(`${method}: ${j.error.message}`);
      return j.result;
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}
const hex = (n) => "0x" + n.toString(16);
const count = (arr) => [...arr.reduce((m, a) => m.set(a, (m.get(a) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);

const file = new URL("./ely-mainnet.json", import.meta.url);
let out = {};
try {
  out = JSON.parse(readFileSync(file, "utf8"));
} catch {}
const bridge = (out.bridge = { elysiumRpc: ELY, hyperEvmRpc: HEVM, at: new Date().toISOString() });

// 1. recent deposits on Elysium (newest first)
const tip = Number(await call(ELY, "eth_blockNumber"));
const deposits = [];
let looked = 0;
for (let b = tip; b > Math.max(0, tip - 20000) && deposits.length < 8; b--) {
  const blk = await call(ELY, "eth_getBlockByNumber", [hex(b), true]).catch(() => null);
  looked++;
  for (const tx of blk?.transactions || []) {
    if (DEPOSIT_TYPES.has(tx.type)) deposits.push({ block: b, ts: Number(blk.timestamp), type: tx.type, hash: tx.hash, from: tx.from, to: tx.to, value: tx.value, l1BlockNumber: blk.l1BlockNumber ? Number(blk.l1BlockNumber) : null });
  }
}
bridge.elysiumBlocksLooked = looked;
bridge.deposits = deposits.slice(0, 8);
console.log(`elysium: looked at ${looked} blocks, ${deposits.length} deposits`);

// 2. on HyperEVM, around each deposit, who emitted the Orbit message events
async function hevmBlockAt(ts) {
  let hi = Number(await call(HEVM, "eth_blockNumber"));
  let lo = Math.max(0, hi - 5_000_000);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const t = Number((await call(HEVM, "eth_getBlockByNumber", [hex(mid), false])).timestamp);
    if (t < ts) lo = mid;
    else hi = mid;
  }
  return hi;
}
const emitters = [];
const checked = [];
for (const d of deposits.slice(0, 5)) {
  // the block's l1BlockNumber (Orbit chains report the parent block) is the best anchor; else time
  const anchor = d.l1BlockNumber || (await hevmBlockAt(d.ts).catch(() => null));
  if (!anchor) continue;
  const from = anchor - 400;
  const found = [];
  for (let s = from; s <= anchor + 20; s += 50) {
    for (const t of Object.values(TOPICS)) {
      const logs = await call(HEVM, "eth_getLogs", [{ fromBlock: hex(s), toBlock: hex(Math.min(anchor + 20, s + 49)), topics: [t] }]).catch(() => []);
      for (const l of logs) found.push({ address: l.address.toLowerCase(), topic: Object.keys(TOPICS).find((k) => TOPICS[k] === t), tx: l.transactionHash, block: Number(l.blockNumber) });
    }
  }
  checked.push({ deposit: d.hash, anchor, events: found.length });
  emitters.push(...found);
}
bridge.checked = checked;
bridge.emitters = count(emitters.map((e) => `${e.topic}:${e.address}`)).slice(0, 10);
bridge.sampleEvents = emitters.slice(0, 10);
// the HyperEVM tx that called the inbox: its "to" is what users send HYPE to
const callers = [];
for (const e of emitters.filter((x) => x.topic === "inboxMessageDelivered").slice(0, 6)) {
  const tx = await call(HEVM, "eth_getTransactionByHash", [e.tx]).catch(() => null);
  if (tx) callers.push({ to: tx.to?.toLowerCase(), value: tx.value, input: tx.input?.slice(0, 10) });
}
bridge.inboxCalls = callers;

writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
const md = "## Elysium bridge probe\n\n```json\n" + JSON.stringify(bridge, null, 1) + "\n```\n";
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
