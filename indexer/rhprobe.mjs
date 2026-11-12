// Robinhood Chain check: runs the indexer over the last N blocks into memory and prints what it found. Read-only.
//   node rhprobe.mjs [blocks back]
import { makeElysium } from "./elysium.mjs";
import { makeMemStore } from "./elymem.mjs";
const RPC = process.env.RH_RPC || "https://rpc.mainnet.chain.robinhood.com";
const back = Number(process.argv[2] || 30000);
const tip = Number(BigInt((await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) })).json()).result));
const store = makeMemStore();
const ely = makeElysium({ rpc: [RPC], step: 1000, startBlock: tip - back, wrapRe: /^W?ETH$/i, noGenesis: true, noTokenUri: true, priceFn: async () => Number(process.env.RH_ETH_USD || 3000), log: console.log }, store);
const t0 = Date.now();
await ely.syncOnce();
const all = [...store.tokens().values()];
const byPad = {}; for (const t of all) byPad[t.launchpad || `maker:${(t.maker || "").slice(0, 10)}`] = (byPad[t.launchpad || `maker:${(t.maker || "").slice(0, 10)}`] || 0) + 1;
console.log("seconds", (Date.now() - t0) / 1000, "tokens", all.length, "trades", [...store.trades.values()].reduce((s, l) => s + l.length, 0));
console.log(byPad);
for (const t of all.slice(0, 8)) console.log(t.symbol, t.venue, t.launchpad, t.manager, t.whype, t.price_hype);
