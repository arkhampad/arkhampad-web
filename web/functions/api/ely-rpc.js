// POST /api/ely-rpc — ArkhamPad's own doorway to Elysium. The site (and the indexer, as a backup) talk
// to this address; it forwards each JSON-RPC call to the first Elysium node that answers, trying the
// next one after a short timeout. Swapping or adding nodes is one Cloudflare variable (ELY_UPSTREAMS,
// comma-separated), with no site change, and upstream nodes only ever see Cloudflare, not our users.
// (rpc.ronspad.fun dropped Oct 31: thousands of blocks behind, it answered with old balances)
const DEFAULT = ["https://rpc-elysium-mainnet.t.conduit.xyz", "https://rpc-live.elysp.com", "https://rpc-live.boxa.club"];
// every public node limits each address to a couple of calls a second; its answer can be a 429 or an error text that names one
const BUSY = /rate limit|too many|capacity|-32005|-32017|\b429\b|upstreams? unavailable|not available to this site/i;
// answers that barely change are kept for a few seconds, so a wallet asking again and again does not use up the nodes
const KEEP = new Map(); const KEEP_FOR = { eth_chainId: 3600e3, eth_gasPrice: 4000, eth_maxPriorityFeePerGas: 4000, net_version: 3600e3, eth_blockNumber: 1500, eth_estimateGas: 1500, eth_feeHistory: 3000, eth_getCode: 20e3, eth_getBalance: 800, eth_call: 800 };
// the same question asked at the same moment shares one trip to the nodes
const FLY = new Map();
const SEND_ALSO = ["https://rpc.ronspad.fun"];
const ALLOWED = /^(eth_(chainId|blockNumber|getBalance|call|estimateGas|gasPrice|maxPriorityFeePerGas|feeHistory|getCode|getLogs|getBlockByNumber|getBlockByHash|getTransactionByHash|getTransactionReceipt|getTransactionCount|sendRawTransaction|getStorageAt)|net_version|web3_clientVersion)$/;
const TIMEOUT = 4000;

const reply = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" },
});

export const onRequestOptions = () => reply("", 204);

export async function onRequestPost({ request, env, waitUntil }) {
  let text;
  try { text = await request.text(); } catch { return reply({ error: "bad request" }, 400); }
  let calls;
  try { calls = JSON.parse(text); } catch { return reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400); }
  const list = Array.isArray(calls) ? calls : [calls];
  const keepMs = !Array.isArray(calls) ? KEEP_FOR[calls.method] : 0;
  const kkey = keepMs ? calls.method + JSON.stringify(calls.params ?? []) : "";
  if (keepMs) { const k = KEEP.get(kkey); if (k && Date.now() - k.at < keepMs) return reply({ ...k.j, id: calls.id ?? null }); if (KEEP.size > 500) KEEP.clear(); }
  if (!list.length || list.length > 50 || list.some((c) => !ALLOWED.test(String(c?.method)))) {
    return reply({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "method not allowed" } }, 400);
  }
  const upstreams = [...new Set([...(env.ELY_UPSTREAMS ? String(env.ELY_UPSTREAMS).split(",") : []), ...DEFAULT].map((u) => u.trim()).filter(Boolean))];
  // Wallets pick the next nonce from eth_getTransactionCount. A node a block behind returns an old count
  // and the wallet's next transaction is rejected ("wrong nonce"). So for that call we ask every node and
  // answer with the highest count, and block-number reads also get the newest head.
  if (!Array.isArray(calls) && (calls.method === "eth_getTransactionCount" || (calls.method === "eth_blockNumber" && !keepMs))) {
    const answers = await Promise.all(upstreams.map(async (url) => {
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(TIMEOUT) });
        const j = await r.json();
        return typeof j?.result === "string" ? BigInt(j.result) : -1n;
      } catch { return -1n; }
    }));
    const best = answers.reduce((a, b) => (b > a ? b : a), -1n);
    if (best >= 0n) return reply({ jsonrpc: "2.0", id: calls.id ?? null, result: `0x${best.toString(16)}` });
  }
  // "has my transaction landed?": the nodes catch up with the chain at different speeds, so ask them all
  // and answer with the first one that has it
  if (!Array.isArray(calls) && (calls.method === "eth_getTransactionReceipt" || calls.method === "eth_getTransactionByHash")) {
    const found = await Promise.any(upstreams.map(async (url) => {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(TIMEOUT) });
      const j = await r.json();
      if (!j?.result) throw new Error("not found");
      return j;
    })).catch(() => null);
    if (found) return reply({ ...found, id: calls.id ?? null });
  }
  const sending = list.some((c) => c.method === "eth_sendRawTransaction");
  // a signed transaction goes to every node at once, so whichever one the wallet reads from next has it
  if (sending && !Array.isArray(calls)) {
    // answer as soon as the first node accepts it; the slower ones keep going in the background
    // a new transaction also goes to the older node we used until Oct 31 (it passes transactions on even
    // when it's behind on blocks), so it reaches every place it used to
    const sendTo = [...new Set([...upstreams, ...SEND_ALSO])];
    const tries = sendTo.map(async (url) => {
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(15000) });
        return await r.text();
      } catch { return null; }
    });
    const isOk = (o) => o && /"result"\s*:\s*"0x[0-9a-f]{64}"/i.test(o);
    const firstOk = await Promise.any(tries.map((t) => t.then((o) => (isOk(o) ? o : Promise.reject())))).catch(() => null);
    if (firstOk) {
      waitUntil?.(Promise.allSettled(tries));
      return reply(firstOk);
    }
    const outs = await Promise.all(tries);
    const known = outs.find((o) => o && /already known|known transaction/i.test(o));
    if (known) return reply(known);
    const first = outs.find(Boolean);
    if (first) return reply(first);
  }
  // any other single read: ask every node at once, answer with the first good reply (a busy node used to
  // cost 4 s before the next was tried, and wallets make several of these per transaction)
  if (!sending && !Array.isArray(calls)) {
    // nodes are started 300 ms apart, so a quick first answer uses one node's allowance instead of all three
    let done = false;
    const tries = upstreams.map(async (url, i) => {
      if (i) await new Promise((r) => setTimeout(r, i * 300));
      if (done) throw Object.assign(new Error("skipped"), { out: "", busy: true });
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(6000) });
      const out = await r.text();
      let j = null;
      try { j = JSON.parse(out); } catch {}
      if (!j) throw new Error(`${new URL(url).host} ${r.status}`);
      if (j.error) throw Object.assign(new Error("rpc"), { out, busy: BUSY.test(out) });
      done = true;
      return out;
    });
    let good = await Promise.any(tries).catch((e) => e);
    // every node busy at the same moment: wait a beat and ask them all again (their limits refill every second)
    for (let round = 0; round < 2 && typeof good !== "string" && (good?.errors || []).every((x) => !x?.out || x.busy); round++) {
      await new Promise((r) => setTimeout(r, 450));
      good = await Promise.any(upstreams.map(async (url) => { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(6000) }); const out = await r.text(); let j = null; try { j = JSON.parse(out); } catch {} if (!j || j.error) throw Object.assign(new Error("busy"), { out: j ? out : "", busy: !j || BUSY.test(out) }); return out; })).catch((e) => e);
    }
    if (typeof good === "string") { waitUntil?.(Promise.allSettled(tries)); if (keepMs) { try { const j = JSON.parse(good); if (j?.result != null) KEEP.set(kkey, { at: Date.now(), j }); } catch {} } return reply(good); }
    const real = (good?.errors || []).find((x) => x?.out && !x.busy);
    if (real) return reply(real.out);
  }
  const why = [];
  let rpcError = null;
  for (const url of upstreams) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(sending ? 15000 : TIMEOUT) });
      const out = await r.text();
      if (!r.ok) {
        why.push(`${new URL(url).host} ${r.status}`);
        // a node that refused with a proper JSON-RPC error (e.g. "execution reverted") still answered
        if (/"error"\s*:/.test(out) && !BUSY.test(out)) rpcError ??= out;
        continue;
      }
      // a node that answers with a rate-limit / server error for every call: try the next one
      if (!sending && (/"code":\s*-32(005|603)/.test(out) || BUSY.test(out))) continue;
      return reply(out);
    } catch (e) { why.push(`${new URL(url).host} ${e?.name === "TimeoutError" ? "timeout" : "down"}`); }
  }
  if (rpcError) return reply(rpcError);
  return reply({ jsonrpc: "2.0", id: Array.isArray(calls) ? null : calls.id ?? null, error: { code: -32603, message: "The Elysium network is busy right now. Please try again in a moment.", data: why.join(", ") } });
}
