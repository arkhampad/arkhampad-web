// Elysium: every token paired with HYPE, from every launchpad (Boxa, ElysPump, Kleos, Uniswap and
// ArkhamPad's own launcher), with its pool, trades, price and holders. Read from the chain itself:
//   - Uniswap v3 style pools: PoolCreated (any factory) where one side is a WHYPE
//   - Uniswap v4 style pools: Initialize (any pool manager) where one side is native HYPE or a WHYPE
//   - trades: the pools' Swap events; holders: every token Transfer
// No library needed (plain JSON-RPC over fetch, BigInt math), so the same code runs on Railway
// (with Postgres, ./elysium-pg.mjs) and in a quick check script (in-memory store).

const T = {
  v3PoolCreated: "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118",
  v4Initialize: "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",
  v3Swap: "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
  v4Swap: "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
  transfer: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
};
const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
const SEL = { slot0: "0x3850c7bd", symbol: "0x95d89b41", name: "0x06fdde03", decimals: "0x313ce567", totalSupply: "0x18160ddd", tokenURI: "0x3c130d90" };

/**
 * Launchpads, recognised by the contract a pool was created through (the creating tx's "to") or,
 * failing that, by the pool manager / factory. Known tokens teach the map at run time: once we see
 * which contract made $BOXA, everything else that contract made is "Boxa" too.
 */
export const KNOWN_TOKENS = [
  { prefix: "0xa3c1", suffix: "95d7", launchpad: "Boxa" }, // BOXA
  { prefix: "0x51c3", suffix: "7e7a", launchpad: "Kleos" }, // KLEOS
  { prefix: "0x7a7a", suffix: "c60b", launchpad: "ElysPump" }, // ELYSP
  { prefix: "0xedb9", suffix: "7afa", launchpad: "ElysPump" }, // e/acc
];
export const KNOWN_CONTRACTS = {
  "0x06c63714fbf1f5753017123e2fcfdede4540b2c4": "Boxa", // Boxa's v4 pool manager (shown on boxa.club)
};

/** Runs async jobs, `n` at a time. */
async function pool(jobs, n) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (i < jobs.length) await jobs[i++]();
  }));
}
const hex = (n) => "0x" + n.toString(16);
const word = (data, i) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const uintAt = (data, i) => BigInt("0x" + word(data, i));
const intAt = (data, i, bits = 256) => BigInt.asIntN(bits, BigInt("0x" + word(data, i)));
const addrTopic = (t) => "0x" + t.slice(26).toLowerCase();
const addrWord = (data, i) => "0x" + word(data, i).slice(24).toLowerCase();
const lc = (a) => String(a || "").toLowerCase();

function decodeString(res) {
  if (!res || res === "0x") return "";
  try {
    if (res.length >= 130) {
      const off = Number(BigInt("0x" + res.slice(2, 66)));
      const len = Number(BigInt("0x" + res.slice(2 + off * 2, 2 + off * 2 + 64)));
      const body = res.slice(2 + off * 2 + 64, 2 + off * 2 + 64 + len * 2);
      return Buffer.from(body, "hex").toString("utf8").replace(/\0/g, "").trim();
    }
    return Buffer.from(res.slice(2), "hex").toString("utf8").replace(/\0/g, "").trim(); // bytes32 names
  } catch {
    return "";
  }
}

export const OWN_RPC = "https://arkhampad.com/api/ely-rpc";

export function makeRpc(urls, log = console.log) {
  // our own Cloudflare doorway is always the last backup, so one node blocking us never stops the indexer
  const list = [...new Set([...String(urls).split(",").map((u) => u.trim()).filter(Boolean), OWN_RPC])];
  let id = 0;
  let at = 0;
  let since = Date.now();
  return async function rpc(method, params = []) {
    let last;
    // after a fail-over, go back to the first (main) node every 2 minutes
    if (at !== 0 && Date.now() - since > 120_000) { at = 0; since = Date.now(); }
    for (let i = 0; i < list.length * 3; i++) {
      const url = list[(at + i) % list.length];
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(8_000) });
        const j = await r.json();
        if (j.error) throw new Error(`${method}: ${j.error.message}`);
        if (at !== (at + i) % list.length) since = Date.now();
        at = (at + i) % list.length;
        return j.result;
      } catch (e) {
        last = e;
        // a node that is a few blocks behind says "beyond current head": just ask the next node
        if (/beyond current head|header not found|unknown block/i.test(e.message)) continue;
        if (/range|too many|limit/i.test(e.message) && method === "eth_getLogs") throw e;
        if (i % list.length === list.length - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    throw last;
  };
}

/** Price of `token` in HYPE from a pool's sqrtPriceX96 (raw units: token1 per token0). */
export function priceFromSqrt(sqrtX96, tokenIs0, decToken = 18, decHype = 18) {
  const s = Number(sqrtX96) / 2 ** 96;
  const p = s * s; // token1 per token0, raw
  if (!(p > 0)) return 0;
  const raw = tokenIs0 ? p : 1 / p;
  return raw * 10 ** (decToken - decHype);
}

/**
 * The indexer. store: { getState(k), setState(k,v), tokens(): Map addr->token, upsertToken(t),
 * addTrades(list), applyTransfers(list), refreshStats(), setMeta(k,v) }.
 * cfg: { rpc, launcher?, startBlock?, step?, log? }
 */
export function makeElysium(cfg, store) {
  const rpc = typeof cfg.rpc === "function" ? cfg.rpc : makeRpc(cfg.rpc);
  const log = cfg.log || console.log;
  const step = cfg.step || 2000;
  const launcher = lc(cfg.launcher);
  const symbolCache = new Map(); // address -> symbol ("" when not a token)
  const isHypeWrap = new Map(); // address -> bool (a WHYPE: symbol WHYPE and wraps native)
  const txTo = new Map(); // tx hash -> to (who made the pool)
  const txFrom = new Map(); // tx hash -> from (the trader)
  const launchpadOf = new Map(Object.entries(KNOWN_CONTRACTS)); // contract -> name
  if (launcher) launchpadOf.set(launcher, "ArkhamPad");
  const poolIndex = new Map(); // v3 pool address or v4 "manager:id" -> token address

  const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]).catch(() => "0x");
  async function symbol(a) {
    if (!symbolCache.has(a)) symbolCache.set(a, decodeString(await call(a, SEL.symbol)));
    return symbolCache.get(a);
  }
  async function hypeWrap(a) {
    if (a === ZERO) return true; // v4 native HYPE
    if (!isHypeWrap.has(a)) isHypeWrap.set(a, /^W?HYPE$/i.test(await symbol(a)));
    return isHypeWrap.get(a);
  }
  async function txField(map, hash, field) {
    if (!map.has(hash)) {
      const tx = await rpc("eth_getTransactionByHash", [hash]).catch(() => null);
      txTo.set(hash, lc(tx?.to));
      txFrom.set(hash, lc(tx?.from));
    }
    return map.get(hash);
  }
  const blockTime = new Map();
  // Old blocks (catching up) get their time interpolated inside the scanned window and their trader
  // from the event itself; only recent blocks cost an extra call each.
  let tipNow = 0;
  let win = null; // { from, to, tFrom, tTo }
  const recent = (b) => tipNow - b < (cfg.liveBlocks ?? 300);
  async function timeOf(b) {
    if (!recent(b) && win && b >= win.from && b <= win.to && win.to > win.from) {
      return Math.round(win.tFrom + ((b - win.from) / (win.to - win.from)) * (win.tTo - win.tFrom));
    }
    if (!blockTime.has(b)) {
      const blk = await rpc("eth_getBlockByNumber", [hex(b), false]).catch(() => null);
      blockTime.set(b, blk ? Number(blk.timestamp) * 1000 : Date.now());
      if (blockTime.size > 5000) blockTime.delete(blockTime.keys().next().value);
    }
    return blockTime.get(b);
  }

  /** Picture and description from a token's metadata URI (data: JSON, https or ipfs). Never throws. */
  async function readMeta(uri) {
    if (!uri) return {};
    try {
      let j;
      if (uri.startsWith("data:application/json")) {
        const body = uri.slice(uri.indexOf(",") + 1);
        j = JSON.parse(uri.includes(";base64,") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body));
      } else if (/^(https?|ipfs):\/\//.test(uri)) {
        const url = uri.replace(/^ipfs:\/\//, "https://ipfs.io/ipfs/");
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!r.ok || Number(r.headers.get("content-length") || 0) > 300_000) return {};
        const type = r.headers.get("content-type") || "";
        if (type.startsWith("image/")) return { image: url };
        j = await r.json();
      } else return {};
      let image = typeof j?.image === "string" ? j.image.replace(/^ipfs:\/\//, "https://ipfs.io/ipfs/") : null;
      if (image && !/^(https:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/.test(image)) image = null;
      if (image && image.length > 120_000) image = null;
      const description = typeof j?.description === "string" ? j.description.slice(0, 600) : null;
      return { image, description };
    } catch {
      return {};
    }
  }

  async function tokenInfo(a) {
    const [name, sym, dec, sup, uri] = await Promise.all([call(a, SEL.name), symbol(a), call(a, SEL.decimals), call(a, SEL.totalSupply), call(a, SEL.tokenURI)]);
    return {
      name: decodeString(name) || sym || "Unknown",
      symbol: sym || "?",
      decimals: dec && dec !== "0x" ? Number(BigInt(dec)) : 18,
      supply: sup && sup !== "0x" ? BigInt(sup).toString() : "0",
      uri: decodeString(uri) || null,
      ...(await readMeta(decodeString(uri) || null)),
    };
  }

  /** Once per start: pictures for tokens indexed before metadata was read. */
  let metaDone = false;
  async function backfillMeta() {
    if (metaDone) return;
    metaDone = true;
    const todo = [...store.tokens().values()].filter((t) => t.uri && t.image == null && !t.metaTried);
    await pool(todo.map((t) => async () => {
      t.metaTried = true;
      const m = await readMeta(t.uri);
      if (m.image || m.description) await store.upsertToken({ ...t, ...m });
    }), 6);
  }

  /**
   * Pictures for coins whose launchpad keeps them off-chain. Public token pages / APIs of Elysium
   * launchpads show each coin's logo; we look it up once (a few coins a minute, politely) and store
   * only the picture's URL. Coins launched on ArkhamPad carry their picture on-chain and skip this.
   */
  const IMG_HOSTS = /^https:\/\/[^"'\s]+\.(?:png|jpe?g|webp|gif)(?:\?[^"'\s]*)?$|^https:\/\/(?:[a-z0-9-]+\.public\.blob\.vercel-storage\.com|stokx\.b-cdn\.net|elysp\.com\/api\/img|elyspump\.com\/api\/img|elysiumpump\.com\/api\/img|ipfs\.[a-z.]+\/ipfs)\//i;
  const imgTried = new Map(); // address -> last try (ms)
  const UA = { "user-agent": "Mozilla/5.0 (compatible; ArkhamPadBot/1.0; +https://arkhampad.com)" };
  function findImg(v, depth = 0) {
    if (depth > 5 || v == null) return null;
    if (typeof v === "string") return IMG_HOSTS.test(v) && !/\/api\/(share|v1\/card)\//.test(v) ? v : null;
    if (Array.isArray(v)) { for (const x of v) { const r = findImg(x, depth + 1); if (r) return r; } return null; }
    if (typeof v === "object") {
      for (const k of ["image", "imageUrl", "image_url", "logo", "logoUrl", "logo_url", "icon", "avatar", "pfp", "img"]) { const r = findImg(v[k], depth + 1); if (r) return r; }
      for (const x of Object.values(v)) { const r = findImg(x, depth + 1); if (r) return r; }
    }
    return null;
  }
  async function lookupImage(a) {
    try {
      const r = await fetch(`https://ronspad.fun/api/v1/token/${a}`, { headers: UA, signal: AbortSignal.timeout(6000) });
      if (r.ok) { const img = findImg(await r.json()); if (img) return img; }
    } catch {}
    try {
      const r = await fetch(`https://boxa.club/token/${a}`, { headers: UA, signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        const html = (await r.text()).slice(0, 2_000_000);
        // the coin's own record: "image":"…" near its address
        const at = html.toLowerCase().indexOf(a);
        const near = at >= 0 ? html.slice(Math.max(0, at - 3000), at + 3000) : html;
        for (const m of near.matchAll(/"(?:image|imageUrl|image_url|logo|icon)\\?"\s*:\s*\\?"(https:[^"\\]+)/g)) if (findImg(m[1])) return m[1];
      }
    } catch {}
    return null;
  }
  let imgAt = 0;
  async function backfillImages() {
    if (Date.now() - imgAt < 60_000) return;
    imgAt = Date.now();
    const now = Date.now();
    const todo = [...store.tokens().values()]
      .filter((t) => !t.ours && !t.image && now - (imgTried.get(t.address) || 0) > 6 * 3600_000)
      .sort((x, y) => (y.vol24_hype || 0) - (x.vol24_hype || 0))
      .slice(0, 8);
    for (const t of todo) {
      imgTried.set(t.address, now);
      const image = await lookupImage(t.address);
      if (image) { t.image = image; await store.upsertToken({ ...t, image }).catch(() => {}); }
    }
    if (todo.length) log(`elysium: pictures looked up for ${todo.length} coins`);
  }

  function launchpadFor(maker, venue) {
    return launchpadOf.get(maker) || launchpadOf.get(venue) || null;
  }

  async function addPool(p) {
    // p: { token, hype, venue: 'v3'|'v4', pool, manager, fee, tickSpacing, hooks, tokenIs0, block, tx, sqrt }
    const tokens = store.tokens();
    const known = tokens.get(p.token);
    if (known && known.pool) return; // first pool wins (the launch pool)
    const info = await tokenInfo(p.token);
    const maker = await txField(txTo, p.tx, "to");
    const creator = await txField(txFrom, p.tx, "from");
    // learn launchpads from known tokens
    for (const k of KNOWN_TOKENS) {
      if (p.token.startsWith(k.prefix) && p.token.endsWith(k.suffix)) {
        if (maker && maker !== p.manager) launchpadOf.set(maker, k.launchpad);
        if (!launchpadOf.has(p.manager)) launchpadOf.set(p.manager, k.launchpad);
      }
    }
    const t = {
      address: p.token,
      ...info,
      venue: p.venue,
      pool: p.pool,
      manager: p.manager,
      whype: p.hype,
      token_is0: p.tokenIs0,
      fee: p.fee,
      tick_spacing: p.tickSpacing,
      hooks: p.hooks || null,
      maker,
      creator,
      launchpad: launchpadFor(maker, p.manager),
      ours: !!launcher && maker === launcher,
      created_block: p.block,
      created_at: new Date(await timeOf(p.block)).toISOString(),
      price_hype: p.sqrt ? priceFromSqrt(p.sqrt, p.tokenIs0, info.decimals) : null,
    };
    poolIndex.set(p.venue === "v3" ? p.pool : `${p.manager}:${p.pool}`, p.token);
    await store.upsertToken(t);
  }

  async function scanPools(from, to) {
    const q = { fromBlock: hex(from), toBlock: hex(to) };
    const [v3, v4] = await Promise.all([rpc("eth_getLogs", [{ ...q, topics: [T.v3PoolCreated] }]), rpc("eth_getLogs", [{ ...q, topics: [T.v4Initialize] }])]);
    const jobs = [];
    for (const l of v3) jobs.push(async () => {
      const t0 = addrTopic(l.topics[1]);
      const t1 = addrTopic(l.topics[2]);
      const h0 = await hypeWrap(t0);
      const h1 = await hypeWrap(t1);
      if (h0 === h1) return; // not a token/HYPE pool
      const token = h0 ? t1 : t0;
      const pool = addrWord(l.data, 1);
      const slot0 = await call(pool, SEL.slot0);
      const sqrt = slot0 && slot0.length >= 66 ? BigInt("0x" + slot0.slice(2, 66)) : null;
      await addPool({ token, hype: h0 ? t0 : t1, venue: "v3", pool, sqrt, manager: lc(l.address), fee: Number(BigInt(l.topics[3])), tickSpacing: Number(intAt(l.data, 0)), tokenIs0: !h0, block: Number(l.blockNumber), tx: l.transactionHash });
    });
    for (const l of v4) jobs.push(async () => {
      const c0 = addrTopic(l.topics[2]);
      const c1 = addrTopic(l.topics[3]);
      const h0 = await hypeWrap(c0);
      const h1 = await hypeWrap(c1);
      if (h0 === h1) return;
      const token = h0 ? c1 : c0;
      await addPool({ token, hype: h0 ? c0 : c1, venue: "v4", pool: l.topics[1].toLowerCase(), manager: lc(l.address), fee: Number(uintAt(l.data, 0)), tickSpacing: Number(intAt(l.data, 1)), hooks: addrWord(l.data, 2), sqrt: uintAt(l.data, 3), tokenIs0: !h0, block: Number(l.blockNumber), tx: l.transactionHash });
    });
    // WHYPE symbols first (shared by many pools), then the pools in parallel
    await pool(jobs, 12);
  }

  async function scanTrades(from, to) {
    const q = { fromBlock: hex(from), toBlock: hex(to) };
    const [v3, v4] = await Promise.all([rpc("eth_getLogs", [{ ...q, topics: [T.v3Swap] }]), rpc("eth_getLogs", [{ ...q, topics: [T.v4Swap] }])]);
    const tokens = store.tokens();
    const out = [];
    const add = async (l, token, tokenDelta, hypeDelta, sqrt, userSideNegativeIsPaid) => {
      const t = tokens.get(token);
      if (!t) return;
      // v3 amounts are the pool's side (positive = pool received); v4 the swapper's side (negative = paid)
      const sold = userSideNegativeIsPaid ? tokenDelta < 0n : tokenDelta > 0n;
      const abs = (x) => (x < 0n ? -x : x);
      const hype = Number(abs(hypeDelta)) / 1e18;
      const amount = Number(abs(tokenDelta)) / 10 ** (t.decimals ?? 18);
      if (!(hype > 0) || !(amount > 0)) return;
      out.push({
        token,
        tx: l.transactionHash,
        log_index: Number(l.logIndex),
        block: Number(l.blockNumber),
        at: new Date(await timeOf(Number(l.blockNumber))).toISOString(),
        side: sold ? "sell" : "buy",
        hype,
        amount,
        price_hype: priceFromSqrt(sqrt, t.token_is0, t.decimals ?? 18),
        trader: recent(Number(l.blockNumber)) ? await txField(txFrom, l.transactionHash, "from") : addrTopic(l.topics[2]),
      });
    };
    const jobs = [];
    for (const l of v3) {
      const token = poolIndex.get(lc(l.address));
      if (!token) continue;
      const t = tokens.get(token);
      const a0 = intAt(l.data, 0);
      const a1 = intAt(l.data, 1);
      jobs.push(() => add(l, token, t.token_is0 ? a0 : a1, t.token_is0 ? a1 : a0, uintAt(l.data, 2), false));
    }
    for (const l of v4) {
      const token = poolIndex.get(`${lc(l.address)}:${l.topics[1].toLowerCase()}`);
      if (!token) continue;
      const t = tokens.get(token);
      const a0 = intAt(l.data, 0);
      const a1 = intAt(l.data, 1);
      jobs.push(() => add(l, token, t.token_is0 ? a0 : a1, t.token_is0 ? a1 : a0, uintAt(l.data, 2), true));
    }
    await pool(jobs, 16);
    out.sort((a, b) => a.block - b.block || a.log_index - b.log_index);
    if (out.length) await store.addTrades(out);
    return out.length;
  }

  async function scanTransfers(from, to) {
    const logs = await rpc("eth_getLogs", [{ fromBlock: hex(from), toBlock: hex(to), topics: [T.transfer] }]);
    const tokens = store.tokens();
    const list = [];
    for (const l of logs) {
      const token = lc(l.address);
      if (!tokens.has(token) || l.topics.length < 3) continue;
      list.push({ token, from: addrTopic(l.topics[1]), to: addrTopic(l.topics[2]), value: BigInt(l.data === "0x" ? 0 : l.data).toString() });
    }
    if (list.length) await store.applyTransfers(list);
    return list.length;
  }

  async function hypeUsd() {
    try {
      const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "allMids" }), signal: AbortSignal.timeout(10_000) });
      const j = await r.json();
      const v = Number(j?.HYPE);
      if (v > 0) await store.setMeta("hype_usd", v);
      return v;
    } catch {
      return null;
    }
  }

  /** One pass: from the saved block to the chain tip (in steps), then stats. Returns blocks done. */
  async function syncOnce() {
    for (const t of store.tokens().values()) poolIndex.set(t.venue === "v3" ? t.pool : `${t.manager}:${t.pool}`, t.address);
    const tip = Number(await rpc("eth_blockNumber"));
    tipNow = tip;
    let last = Number((await store.getState("ely_block")) ?? (cfg.startBlock ?? 0) - 1);
    const startAt = last;
    while (last < tip) {
      let to = Math.min(tip, last + step);
      if (!recent(to)) {
        const [a, b] = await Promise.all([rpc("eth_getBlockByNumber", [hex(last + 1), false]), rpc("eth_getBlockByNumber", [hex(to), false])]);
        win = { from: last + 1, to, tFrom: Number(a.timestamp) * 1000, tTo: Number(b.timestamp) * 1000 };
      }
      try {
        await scanPools(last + 1, to);
        await scanTrades(last + 1, to);
        await scanTransfers(last + 1, to);
      } catch (e) {
        if (step > 100 && /range|too many|limit/i.test(e.message)) {
          to = last + Math.floor(step / 4);
          await scanPools(last + 1, to);
          await scanTrades(last + 1, to);
          await scanTransfers(last + 1, to);
        } else throw e;
      }
      last = to;
      await store.setState("ely_block", last);
      if (cfg.progress) log(`elysium: block ${last}/${tip}, ${store.tokens().size} tokens`);
    }
    return last - startAt;
  }

  let statsAt = 0;
  let pageStatsAt = 0;
  async function loop() {
    log(`elysium: indexing every HYPE pair (launcher ${launcher || "not set"})`);
    for (;;) {
      try {
        const n = await syncOnce();
        backfillMeta().catch(() => {});
        backfillImages().catch(() => {});
        // list stats once a minute (each run reads the database; keeps Supabase disk use low)
        if (Date.now() - statsAt > 60_000) {
          statsAt = Date.now();
          await hypeUsd();
          await store.refreshStats();
        }
        if (store.saveStats && Date.now() - pageStatsAt > 5 * 60_000) {
          pageStatsAt = Date.now();
          await store.saveStats().catch((e) => log(`elysium: stats ${e.message}`));
        }
        if (n > 500) log(`elysium: ${n} blocks, ${store.tokens().size} tokens`);
      } catch (e) {
        log(`elysium: ${e.message}`);
        await new Promise((r) => setTimeout(r, 10_000));
      }
      await new Promise((r) => setTimeout(r, cfg.pollMs || 3000));
    }
  }

  return { syncOnce, loop, hypeUsd, launchpadOf };
}
