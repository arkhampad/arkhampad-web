// GET /api/ely-test-board?launcher=0x..&router=0x..&from=<block>&me=0x..
// Testnet (chain 99801) leaderboard: launches (Launched events from our test launcher, by creator) and trades
// (Trade events from our test router, by user) since the deploy block (at most ~7 days back), plus the
// same counts for "today" (UTC). One shared result is cached at the edge for 5 minutes; `me` only picks
// the visitor's own numbers out of it. Env: TESTNET_RPC (optional).
const DEFAULT_RPC = "https://rpc-elysium-testnet.t.conduit.xyz";
const json = (b, status = 200, ttl = 0) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": ttl ? `public, max-age=30, s-maxage=${ttl}` : "no-store" } });
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || "");

let rid = 0;
async function rpc(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params }), signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}
const hex = (n) => "0x" + n.toString(16);
const topicAddr = (t) => "0x" + String(t).slice(26).toLowerCase();

async function logs(url, address, topic0, from, to) {
  const out = [];
  const STEP = 50_000;
  for (let a = from, n = 0; a <= to && n < 60; a += STEP, n++) {
    const b = Math.min(to, a + STEP - 1);
    out.push(...(await rpc(url, "eth_getLogs", [{ address, fromBlock: hex(a), toBlock: hex(b), topics: [topic0] }])));
  }
  return out;
}

async function build(url, launcher, router, deployBlock, T) {
  const latestHex = await rpc(url, "eth_blockNumber", []);
  const latest = Number(BigInt(latestHex));
  // average block time from the last 20k blocks, to find "7 days ago" and "today (UTC) started"
  const back = Math.min(20_000, latest);
  const [bNow, bOld] = await Promise.all([rpc(url, "eth_getBlockByNumber", [hex(latest), false]), rpc(url, "eth_getBlockByNumber", [hex(latest - back), false])]);
  const tNow = Number(BigInt(bNow.timestamp));
  const tOld = Number(BigInt(bOld.timestamp));
  const perBlock = back > 0 && tNow > tOld ? (tNow - tOld) / back : 1;
  const weekAgo = Math.max(deployBlock, latest - Math.ceil((7 * 86400) / perBlock));
  const dayStart = Math.floor(tNow / 86400) * 86400;
  const todayFrom = latest - Math.floor((tNow - dayStart) / perBlock);
  const [L, R] = await Promise.all([
    launcher ? logs(url, launcher, T.launched, weekAgo, latest) : [],
    router ? logs(url, router, T.trade, weekAgo, latest) : [],
  ]);
  const map = {};
  const row = (a) => (map[a] ??= { a, l: 0, t: 0, lt: 0, tt: 0 });
  for (const x of L) { const r = row(topicAddr(x.topics[2])); r.l++; if (Number(BigInt(x.blockNumber)) >= todayFrom) r.lt++; }
  for (const x of R) { const r = row(topicAddr(x.topics[1])); r.t++; if (Number(BigInt(x.blockNumber)) >= todayFrom) r.tt++; }
  return { updated: new Date().toISOString(), wallets: Object.keys(map).length, launches: L.length, trades: R.length, map };
}

export async function onRequestGet({ request, env, waitUntil }) {
  const u = new URL(request.url);
  const launcher = (u.searchParams.get("launcher") || "").toLowerCase();
  const router = (u.searchParams.get("router") || "").toLowerCase();
  const from = Math.max(0, Number(u.searchParams.get("from")) || 0);
  const me = (u.searchParams.get("me") || "").toLowerCase();
  if (!isAddr(launcher) && !isAddr(router)) return json({ ready: false });
  const url = env.TESTNET_RPC || DEFAULT_RPC;
  const cache = caches.default;
  const key = new Request(`${u.origin}/__testboard/${launcher}/${router}/${from}`);
  let data = null;
  const hit = await cache.match(key);
  if (hit) data = await hit.json();
  if (!data) {
    try {
      const { keccak256, toBytes } = await import("viem");
      const T = {
        launched: keccak256(toBytes("Launched(address,address,address,uint256,string,string,string,uint256,uint256,uint256)")),
        trade: keccak256(toBytes("Trade(address,address,bool,uint256,uint256,uint256)")),
      };
      data = await build(url, isAddr(launcher) ? launcher : null, isAddr(router) ? router : null, from, T);
      waitUntil(cache.put(key, new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "cache-control": "public, s-maxage=300" } })));
    } catch (e) {
      return json({ ready: true, error: "Testnet is not answering right now.", detail: String(e?.message || e).slice(0, 120) }, 502);
    }
  }
  const rows = Object.values(data.map);
  const top = rows.sort((a, b) => b.l * 5 + b.t - (a.l * 5 + a.t)).slice(0, 20).map((r) => ({ address: r.a, launches: r.l, trades: r.t }));
  const mine = isAddr(me) ? data.map[me] ?? { l: 0, t: 0, lt: 0, tt: 0 } : null;
  return json({ ready: true, updated: data.updated, wallets: data.wallets, launches: data.launches, trades: data.trades, top, me: mine ? { launches: mine.l, trades: mine.t, launchesToday: mine.lt, tradesToday: mine.tt } : null }, 200, 60);
}
