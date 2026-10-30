// POST /api/ely-rpc — ArkhamPad's own doorway to Elysium. The site (and the indexer, as a backup) talk
// to this address; it forwards each JSON-RPC call to the first Elysium node that answers, trying the
// next one after a short timeout. Swapping or adding nodes is one Cloudflare variable (ELY_UPSTREAMS,
// comma-separated), with no site change, and upstream nodes only ever see Cloudflare, not our users.
const DEFAULT = ["https://rpc-live.boxa.club", "https://rpc.ronspad.fun"];
const ALLOWED = /^(eth_(chainId|blockNumber|getBalance|call|estimateGas|gasPrice|maxPriorityFeePerGas|feeHistory|getCode|getLogs|getBlockByNumber|getBlockByHash|getTransactionByHash|getTransactionReceipt|getTransactionCount|sendRawTransaction|getStorageAt)|net_version|web3_clientVersion)$/;
const TIMEOUT = 4000;

const reply = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" },
});

export const onRequestOptions = () => reply("", 204);

export async function onRequestPost({ request, env }) {
  let text;
  try { text = await request.text(); } catch { return reply({ error: "bad request" }, 400); }
  let calls;
  try { calls = JSON.parse(text); } catch { return reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400); }
  const list = Array.isArray(calls) ? calls : [calls];
  if (!list.length || list.length > 50 || list.some((c) => !ALLOWED.test(String(c?.method)))) {
    return reply({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "method not allowed" } }, 400);
  }
  const upstreams = (env.ELY_UPSTREAMS ? String(env.ELY_UPSTREAMS).split(",") : DEFAULT).map((u) => u.trim()).filter(Boolean);
  const sending = list.some((c) => c.method === "eth_sendRawTransaction");
  for (const url of upstreams) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(sending ? 15000 : TIMEOUT) });
      if (!r.ok) continue;
      const out = await r.text();
      // a node that answers with a rate-limit / server error for every call: try the next one
      if (!sending && /"code":\s*-32(005|603)|rate limit|too many requests/i.test(out)) continue;
      return reply(out);
    } catch { /* next node */ }
  }
  return reply({ jsonrpc: "2.0", id: Array.isArray(calls) ? null : calls.id ?? null, error: { code: -32603, message: "Elysium nodes are not answering right now" } }, 503);
}
