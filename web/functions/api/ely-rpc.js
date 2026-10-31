// POST /api/ely-rpc — ArkhamPad's own doorway to Elysium. The site (and the indexer, as a backup) talk
// to this address; it forwards each JSON-RPC call to the first Elysium node that answers, trying the
// next one after a short timeout. Swapping or adding nodes is one Cloudflare variable (ELY_UPSTREAMS,
// comma-separated), with no site change, and upstream nodes only ever see Cloudflare, not our users.
// (rpc.ronspad.fun dropped Oct 31: thousands of blocks behind, it answered with old balances)
const DEFAULT = ["https://rpc-live.elysp.com", "https://rpc-live.boxa.club"];
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
  if (!list.length || list.length > 50 || list.some((c) => !ALLOWED.test(String(c?.method)))) {
    return reply({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "method not allowed" } }, 400);
  }
  const upstreams = [...new Set([...(env.ELY_UPSTREAMS ? String(env.ELY_UPSTREAMS).split(",") : []), ...DEFAULT].map((u) => u.trim()).filter(Boolean))];
  // Wallets pick the next nonce from eth_getTransactionCount. A node a block behind returns an old count
  // and the wallet's next transaction is rejected ("wrong nonce"). So for that call we ask every node and
  // answer with the highest count, and block-number reads also get the newest head.
  if (!Array.isArray(calls) && (calls.method === "eth_getTransactionCount" || calls.method === "eth_blockNumber")) {
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
    const tries = upstreams.map(async (url) => {
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
    const tries = upstreams.map(async (url) => {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(6000) });
      const out = await r.text();
      let j = null;
      try { j = JSON.parse(out); } catch {}
      if (!j) throw new Error(`${new URL(url).host} ${r.status}`);
      if (j.error) throw Object.assign(new Error("rpc"), { out, busy: /rate limit|too many|capacity|-32005/i.test(out) });
      return out;
    });
    const good = await Promise.any(tries).catch((e) => e);
    if (typeof good === "string") { waitUntil?.(Promise.allSettled(tries)); return reply(good); }
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
        if (/"error"\s*:/.test(out) && !/rate limit|too many|capacity|-32005/i.test(out)) rpcError ??= out;
        continue;
      }
      // a node that answers with a rate-limit / server error for every call: try the next one
      if (!sending && /"code":\s*-32(005|603)|rate limit|too many requests/i.test(out)) continue;
      return reply(out);
    } catch (e) { why.push(`${new URL(url).host} ${e?.name === "TimeoutError" ? "timeout" : "down"}`); }
  }
  if (rpcError) return reply(rpcError);
  return reply({ jsonrpc: "2.0", id: Array.isArray(calls) ? null : calls.id ?? null, error: { code: -32603, message: "The Elysium network is busy right now. Please try again in a moment.", data: why.join(", ") } });
}
