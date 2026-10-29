// Elysium mainnet probe: which RPC answers, and which contracts the chain's DEXes and launchpads use
// (Uniswap v3 factory + position manager + routers, Uniswap v4 pool manager, WHYPE, launchpad
// factories). Read-only public chain data. Writes indexer/ely-mainnet.json and a summary.
//
//   node elyprobe.mjs [rpc]

import { writeFileSync, appendFileSync } from "node:fs";

const RPCS = [process.argv[2], process.env.ELY_RPC, "https://rpc.ronspad.fun", "https://rpc-elysium-mainnet.t.conduit.xyz", "https://rpc.elysium.kinetiq.xyz", "https://mainnet-rpc.elysium.kinetiq.xyz"].filter(Boolean);
const T = {
  v3PoolCreated: "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118",
  v3IncreaseLiquidity: "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f",
  v3Swap: "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
  v4Initialize: "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",
  v2PairCreated: "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9",
  deposit: "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c", // WETH-style Deposit
};
const WELL_KNOWN = {
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  create2Deployer: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
};

let RPC = null;
let id = 0;
async function rpc(method, params = [], url = RPC) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(20_000) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const hex = (n) => "0x" + n.toString(16);
const addr = (topic) => "0x" + topic.slice(-40).toLowerCase();
const count = (arr) => [...arr.reduce((m, a) => m.set(a, (m.get(a) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);

const out = { rpcs: [], at: new Date().toISOString() };
for (const u of RPCS) {
  try {
    const [chain, block] = await Promise.all([rpc("eth_chainId", [], u), rpc("eth_blockNumber", [], u)]);
    out.rpcs.push({ url: u, chainId: Number(chain), block: Number(block) });
    if (!RPC && Number(chain) === 99901) RPC = u;
  } catch (e) {
    out.rpcs.push({ url: u, error: e.message.slice(0, 120) });
  }
}
console.log(out.rpcs);
if (!RPC) {
  writeFileSync(new URL("./ely-mainnet.json", import.meta.url), JSON.stringify(out, null, 1));
  throw new Error("no Elysium mainnet RPC answered");
}
out.rpc = RPC;
const tip = Number(await rpc("eth_blockNumber"));
out.tip = tip;

async function logs(topic0, address) {
  const all = [];
  for (let from = 0; from <= tip; from += 5000) {
    const q = { fromBlock: hex(from), toBlock: hex(Math.min(tip, from + 4999)), topics: [topic0] };
    if (address) q.address = address;
    try {
      all.push(...(await rpc("eth_getLogs", [q])));
    } catch (e) {
      // range too big for this node: halve it
      for (let f = from; f <= Math.min(tip, from + 4999); f += 1000) all.push(...(await rpc("eth_getLogs", [{ ...q, fromBlock: hex(f), toBlock: hex(Math.min(tip, f + 999)) }]).catch(() => [])));
    }
  }
  return all;
}

// Uniswap v3: factory = who emits PoolCreated; WHYPE = the token in most pools
const created = await logs(T.v3PoolCreated);
out.v3 = { pools: created.length, factories: count(created.map((l) => l.address.toLowerCase())).slice(0, 5) };
const tokens = count(created.flatMap((l) => [addr(l.topics[1]), addr(l.topics[2])]));
out.v3.topTokens = tokens.slice(0, 6);
const fees = count(created.map((l) => Number(BigInt(l.topics[3]))));
out.v3.fees = fees;
// who created the pools (launchpad factories): the tx's "to"
const creators = [];
for (const l of created.slice(-150)) {
  const tx = await rpc("eth_getTransactionByHash", [l.transactionHash]).catch(() => null);
  if (tx?.to) creators.push(tx.to.toLowerCase());
}
out.v3.poolCreatedBy = count(creators).slice(0, 10);

// position manager = who emits IncreaseLiquidity
const inc = await logs(T.v3IncreaseLiquidity);
out.v3.positionManagers = count(inc.map((l) => l.address.toLowerCase())).slice(0, 5);

// routers: the "to" of recent swap transactions
const swaps = (await logs(T.v3Swap)).slice(-200);
out.v3.swaps = swaps.length;
const swapTo = [];
for (const l of swaps.slice(-80)) {
  const tx = await rpc("eth_getTransactionByHash", [l.transactionHash]).catch(() => null);
  if (tx?.to) swapTo.push(tx.to.toLowerCase());
}
out.v3.swapsSentTo = count(swapTo).slice(0, 10);

// Uniswap v4 and v2-style
const init = await logs(T.v4Initialize);
out.v4 = { pools: init.length, poolManagers: count(init.map((l) => l.address.toLowerCase())).slice(0, 3), hooks: count(init.map((l) => "0x" + l.data.slice(2 + 64 * 2 + 24, 2 + 64 * 3))).slice(0, 8) };
const pairs = await logs(T.v2PairCreated);
out.v2 = { pairs: pairs.length, factories: count(pairs.map((l) => l.address.toLowerCase())).slice(0, 3) };

// WHYPE candidate: confirm symbol
for (const [a] of tokens.slice(0, 3)) {
  try {
    const sym = await rpc("eth_call", [{ to: a, data: "0x95d89b41" }, "latest"]);
    const s = Buffer.from(sym.slice(130), "hex").toString("utf8").replace(/\0/g, "");
    (out.tokenSymbols ||= {})[a] = s;
  } catch {}
}
// standard contracts present?
out.wellKnown = {};
for (const [k, a] of Object.entries(WELL_KNOWN)) out.wellKnown[k] = ((await rpc("eth_getCode", [a, "latest"]).catch(() => "0x")) || "0x").length > 2;

writeFileSync(new URL("./ely-mainnet.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
const md = "## Elysium mainnet probe\n\n```json\n" + JSON.stringify(out, null, 1) + "\n```\n";
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
