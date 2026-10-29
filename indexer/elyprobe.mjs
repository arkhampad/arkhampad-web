// Elysium mainnet probe, part 3: confirm the official bridge found in part 2.
// Checks on HyperEVM that the Orbit Inbox belongs to Elysium (Inbox → Bridge → Rollup → chainId 99901)
// and reads how long withdrawals wait (confirm period). Read-only. Adds "bridgeCheck" to
// indexer/ely-mainnet.json.
//
//   node elyprobe.mjs [inbox address]

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const HEVM = process.env.HYPEREVM_RPC || "https://rpc.hyperliquid.xyz/evm";
const INBOX = (process.argv[2] || "0xce59f8b65ad41c9dae4c07a0571a39824bd92cff").toLowerCase();
const SEL = { bridge: "0xe78cea92", rollup: "0xcb23bcb5", chainId: "0x9a8a0592", confirmPeriodBlocks: "0x2e7acfa6", sequencerInbox: "0xee35f327", activeOutbox: "0xab5d8943", nativeToken: "0xe1758bd8" };

let id = 0;
async function call(method, params) {
  const r = await fetch(HEVM, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(20_000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const read = (to, sel) => call("eth_call", [{ to, data: sel }, "latest"]).catch((e) => `error: ${e.message}`);
const asAddr = (r) => (typeof r === "string" && r.length >= 66 ? "0x" + r.slice(-40) : r);
const asNum = (r) => (typeof r === "string" && r.startsWith("0x") ? Number(BigInt(r)) : r);

const c = { inbox: INBOX };
c.bridge = asAddr(await read(INBOX, SEL.bridge));
c.sequencerInboxFromInbox = asAddr(await read(INBOX, SEL.sequencerInbox));
if (/^0x[0-9a-f]{40}$/.test(c.bridge)) {
  c.rollup = asAddr(await read(c.bridge, SEL.rollup));
  c.activeOutbox = asAddr(await read(c.bridge, SEL.activeOutbox));
  c.nativeToken = asAddr(await read(c.bridge, SEL.nativeToken)); // error = native HYPE (no ERC-20 gas token)
}
if (/^0x[0-9a-f]{40}$/.test(c.rollup)) {
  c.chainId = asNum(await read(c.rollup, SEL.chainId));
  c.confirmPeriodBlocks = asNum(await read(c.rollup, SEL.confirmPeriodBlocks));
}
// HyperEVM blocks per hour, to turn the confirm period into time
try {
  const tip = Number(await call("eth_blockNumber", []));
  const [a, b] = await Promise.all([call("eth_getBlockByNumber", ["0x" + tip.toString(16), false]), call("eth_getBlockByNumber", ["0x" + (tip - 3000).toString(16), false])]);
  c.hyperEvmSecondsPerBlock = (Number(a.timestamp) - Number(b.timestamp)) / 3000;
  // Orbit counts the confirm period in parent-chain (L1) blocks; Arbitrum-style chains use Ethereum's
  // block number via the parent's ArbSys, so both readings are shown.
  if (typeof c.confirmPeriodBlocks === "number") {
    c.withdrawWaitIfHyperEvmBlocksHours = +((c.confirmPeriodBlocks * c.hyperEvmSecondsPerBlock) / 3600).toFixed(2);
    c.withdrawWaitIf12sBlocksHours = +((c.confirmPeriodBlocks * 12) / 3600).toFixed(2);
  }
} catch {}
c.isElysium = c.chainId === 99901;

const file = new URL("./ely-mainnet.json", import.meta.url);
let out = {};
try {
  out = JSON.parse(readFileSync(file, "utf8"));
} catch {}
out.bridgeCheck = c;
writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
const md = "## Elysium bridge check\n\n```json\n" + JSON.stringify(c, null, 1) + "\n```\n";
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
