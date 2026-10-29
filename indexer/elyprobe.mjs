// Elysium check: runs the Elysium indexer (./elysium.mjs) over the whole mainnet into memory and
// prints what the site would show: tokens per launchpad, the top tokens, trades and holders.
// Read-only. Adds "indexCheck" to indexer/ely-mainnet.json.
//
//   node elyprobe.mjs [elysium rpc]

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { makeElysium } from "./elysium.mjs";
import { makeMemStore } from "./elymem.mjs";

const RPC = process.argv[2] || process.env.ELYSIUM_RPC || "https://rpc-live.boxa.club";
const store = makeMemStore();
const ely = makeElysium({ rpc: RPC, step: 2000, log: console.log, progress: true }, store);
const t0 = Date.now();
const blocks = await ely.syncOnce();
await ely.hypeUsd();
await store.refreshStats();
const secs = (Date.now() - t0) / 1000;

const all = [...store.tokens().values()];
const byPad = {};
for (const t of all) byPad[t.launchpad || `other:${t.maker?.slice(0, 10)}`] = (byPad[t.launchpad || `other:${t.maker?.slice(0, 10)}`] || 0) + 1;
const top = all.sort((a, b) => (b.vol24_hype || 0) - (a.vol24_hype || 0)).slice(0, 20);
const tradesTotal = [...store.trades.values()].reduce((s, l) => s + l.length, 0);
const check = {
  rpc: RPC,
  blocks,
  seconds: secs,
  hypeUsd: store.meta.get("hype_usd"),
  tokens: all.length,
  trades: tradesTotal,
  byLaunchpad: Object.entries(byPad).sort((a, b) => b[1] - a[1]),
  launchpadContracts: [...ely.launchpadOf.entries()],
  top: top.map((t) => ({ symbol: t.symbol, name: t.name, address: t.address, pad: t.launchpad, venue: t.venue, mcapUsd: Math.round(t.mcap_usd || 0), vol24Hype: +(t.vol24_hype || 0).toFixed(2), txns: (t.buys24 || 0) + (t.sells24 || 0), change24: t.change24 == null ? null : +t.change24.toFixed(1), holders: t.holders, priceHype: t.price_hype })),
};
const file = new URL("./ely-mainnet.json", import.meta.url);
let out = {};
try {
  out = JSON.parse(readFileSync(file, "utf8"));
} catch {}
out.indexCheck = check;
writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
const md = "## Elysium index check\n\n```json\n" + JSON.stringify(check, null, 1) + "\n```\n";
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
