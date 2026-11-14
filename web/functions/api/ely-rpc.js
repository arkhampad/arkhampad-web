// POST /api/ely-rpc — ElyScreener's own doorway to Elysium, the address wallets use for the Elysium network. It
// forwards each JSON-RPC call to the first Elysium node that answers, trying the
// next one after a short timeout. Swapping or adding nodes is one Cloudflare variable (ELY_UPSTREAMS,
// comma-separated), with no site change, and upstream nodes only ever see Cloudflare, not our users.
// (rpc.ronspad.fun dropped Oct 31: thousands of blocks behind, it answered with old balances)
const DEFAULT = ["https://rpc-live.elysp.com", "https://rpc-elysium-mainnet.t.conduit.xyz", "https://rpc-live.boxa.club", "https://elyspump-live-rpc.fly.dev"];
const SEND_ALSO = ["https://rpc.ronspad.fun"];
const ALLOWED = /^(eth_(chainId|blockNumber|getBalance|call|estimateGas|gasPrice|maxPriorityFeePerGas|feeHistory|getCode|getLogs|getBlockByNumber|getBlockByHash|getTransactionByHash|getTransactionReceipt|getTransactionCount|sendRawTransaction|getStorageAt)|net_version|web3_clientVersion)$/;
const TIMEOUT = 4000;
// Short-lived answers kept in memory: every wallet repeats the same few reads (chain id, gas price, head block) and
// the nodes throttle by address, so we ask them once and share the answer for a moment.
const MEM = new Map();
const TTL = { eth_chainId: 3600e3, net_version: 3600e3, eth_gasPrice: 3e3, eth_maxPriorityFeePerGas: 3e3, eth_blockNumber: 1.5e3, eth_feeHistory: 3e3, eth_getBalance: 2e3, eth_call: 2e3, eth_estimateGas: 2e3, eth_getCode: 60e3 };
const STALE_OK = new Set(["eth_chainId", "net_version", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_blockNumber"]); // when every node is throttled these may be answered a little late
const memGet = (k, stale) => { const e = MEM.get(k); if (e && (e.t > Date.now() || (stale && e.t + 10 * 60e3 > Date.now()))) return e.v; if (e && e.t + 10 * 60e3 <= Date.now()) MEM.delete(k); return null; };
const memSet = (k, v, ttl) => { if (MEM.size > 500) MEM.clear(); MEM.set(k, { v, t: Date.now() + ttl }); };


const reply = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" },
});

export const onRequestOptions = () => reply("", 204);

async function handle({ request, env, waitUntil }, text) {
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

export async function onRequestPost(ctx) {
  let text;
  try { text = await ctx.request.text(); } catch { return reply({ error: "bad request" }, 400); }
  let one = null; try { one = JSON.parse(text); } catch {}
  const ttl = one && !Array.isArray(one) ? TTL[String(one.method)] : 0;
  let key = null;
  if (ttl) { key = one.method + JSON.stringify(one.params ?? []); const hit = memGet(key); if (hit) return reply({ ...hit, id: one.id ?? null }); }
  // busy nodes answer "rate limit" for a moment: try again a few times before telling the wallet anything
  let res;
  for (let i = 0; i < 5; i++) {
    res = await handle(ctx, text);
    const out = await res.clone().text();
    if (!/network is busy|upstreams unavailable|rate limit|too many requests/i.test(out)) {
      if (ttl && /"result"/.test(out) && !/"error"/.test(out)) { try { memSet(key, JSON.parse(out), ttl); } catch {} }
      return res;
    }
    await new Promise((r) => setTimeout(r, 300 * (i + 1) + Math.random() * 300));
  }
  if (key && STALE_OK.has(String(one.method))) { const old = memGet(key, true); if (old) return reply({ ...old, id: one.id ?? null }); }
  return res;
}
