// Four.Meme on BNB Chain: every coin that is created on its TokenManager2, with its price, trades and (approximate) holders,
// read from the contract's own events. Writes into the bnb_ tables through the same store as the rest of the BNB indexer
// (./elysium-pg.mjs), so lists, charts, holders and stats work for these coins like for any other.
//
//   TokenCreate   -> a new coin (venue "fourmeme", pool = TokenManager2, launchpad "Four.Meme")
//   TokenPurchase -> buy  (BNB in, tokens out)      TokenSale -> sell (tokens in, BNB out)
//   LiquidityAdded-> the coin graduated: it now has a PancakeSwap pool (marked in state, the coin stays listed)
//
// Holders: every buy / sell is also booked as a balance change (a synthetic transfer from / to the zero address), so the
// holder count and top-10 share follow buyers and sellers on the curve. Wallet-to-wallet transfers are not seen, so these
// two numbers are approximate until a coin graduates.

import { makeRpc } from "./elysium.mjs";

export const FM_HELPER = "0xF251F83e40a78868FcfA3FA4599Dad6494E46034";
export const FM_MANAGER = "0x5c952063c7fc8610ffdb798152d69f0b9550762b";
const T = {
  create: "0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20",
  buy: "0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942",
  sell: "0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19",
  graduated: "0xc18aa71171b358b706fe3dd345299685ba21a5316c66ffa9e319268b033c44b0",
};
const ZERO = "0x0000000000000000000000000000000000000000";
const hex = (n) => "0x" + n.toString(16);
const word = (d, i) => d.slice(2 + i * 64, 2 + (i + 1) * 64);
const addr = (d, i) => "0x" + word(d, i).slice(24);
const big = (d, i) => BigInt("0x" + word(d, i));
const str = (d, i) => {
  // dynamic string whose offset is in word i
  const off = Number(big(d, i)) * 2 + 2;
  const len = Number(BigInt("0x" + d.slice(off, off + 64)));
  const bytes = d.slice(off + 64, off + 64 + len * 2);
  return Buffer.from(bytes, "hex").toString("utf8").replace(/\0/g, "").trim();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fourMemeLoop({ rpcUrls, store, log = console.log, manager = FM_MANAGER, back = 300_000 }) {
  const rpc = makeRpc(rpcUrls, () => {}, true);
  const mgr = manager.toLowerCase();
  const blockTime = new Map();
  const timesOf = async (blocks) => {
    const need = [...new Set(blocks)].filter((b) => !blockTime.has(b));
    for (let i = 0; i < need.length; i += 40) {
      const part = need.slice(i, i + 40);
      const res = await Promise.all(part.map((b) => rpc("eth_getBlockByNumber", [hex(b), false]).catch(() => null)));
      part.forEach((b, k) => blockTime.set(b, res[k] ? Number(res[k].timestamp) * 1000 : Date.now()));
    }
    if (blockTime.size > 20_000) for (const k of [...blockTime.keys()].slice(0, 10_000)) blockTime.delete(k);
  };
  const decimals = 18;
  // log reads: any node that answers wins (public nodes rate limit by address; "limit exceeded" is not about the range)
  const urls = [...new Set([...String(rpcUrls).split(",").map((u) => u.trim()).filter(Boolean), "https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed1.defibit.io", "https://bsc-dataseed1.ninicoin.io", "https://bsc.drpc.org", "https://1rpc.io/bnb"])];
  let at = 0;
  async function getLogs(filter) {
    let last;
    for (let i = 0; i < urls.length; i++) {
      const k = (at + i) % urls.length;
      try {
        const r = await fetch(urls[k], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [filter] }), signal: AbortSignal.timeout(15_000) });
        const j = await r.json();
        if (j.error) throw new Error(j.error.message);
        if (!Array.isArray(j.result)) throw new Error("no result");
        at = k;
        return j.result;
      } catch (e) { last = e; }
    }
    throw last;
  }

  // Four.Meme also has coins whose curve is paid in a BEP20 (USDT ...): their amounts are not BNB, so they are not listed.
  // Helper3.getTokenInfo(token) -> word 2 is the quote token (zero address = BNB)
  const skip = new Set();
  const bnbQuoted = new Map();
  async function isBnb(token) {
    if (skip.has(token)) return false;
    if (bnbQuoted.has(token)) return true;
    try {
      const r = await rpc("eth_call", [{ to: FM_HELPER, data: "0x1f69565f" + token.slice(2).padStart(64, "0") }, "latest"]);
      if (typeof r !== "string" || r.length < 2 + 64 * 3) return true; // unknown: keep, ask again later
      if (/^0+$/.test(word(r, 2))) { bnbQuoted.set(token, true); return true; }
      skip.add(token);
      return false;
    } catch { return true; }
  }

  // coin picture from Four.Meme's own page data (best effort: any failure just leaves the picture to DexScreener)
  const imgTried = new Map();
  async function pictures() {
    const todo = [...store.tokens().values()].filter((t) => t.venue === "fourmeme" && !t.image && Date.now() - (imgTried.get(t.address) || 0) > 3 * 3600_000).slice(0, 12);
    for (const t of todo) {
      imgTried.set(t.address, Date.now());
      try {
        const r = await fetch(`https://four.meme/meme-api/v1/private/token/get?address=${t.address}`, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const j = await r.json();
        const d = j?.data || {};
        let img = d.image || d.img || d.logo;
        if (typeof img === "string" && img && !/^https?:/.test(img)) img = `https://static.four.meme${img.startsWith("/") ? "" : "/"}${img}`;
        if (typeof img === "string" && /^https:\/\//.test(img)) await store.upsertToken({ ...t, image: img, description: d.descr || d.description || t.description || null });
      } catch {}
    }
  }

  async function handle(logs) {
    const blocks = logs.map((l) => Number(l.blockNumber));
    await timesOf(blocks);
    const trades = [];
    const moves = [];
    const lastPrice = new Map();
    for (const l of logs) {
      const t0 = l.topics[0];
      const b = Number(l.blockNumber);
      const at = new Date(blockTime.get(b) ?? Date.now()).toISOString();
      if (t0 === T.create) {
        const token = addr(l.data, 1).toLowerCase();
        if (store.tokens().get(token)) continue;
        if (!(await isBnb(token))) continue;
        const supply = big(l.data, 5);
        await store.upsertToken({
          address: token,
          name: str(l.data, 3) || null,
          symbol: str(l.data, 4) || null,
          decimals,
          supply: supply.toString(),
          uri: null,
          venue: "fourmeme",
          pool: mgr,
          manager: mgr,
          whype: ZERO,
          token_is0: false,
          fee: 100,
          tick_spacing: null,
          hooks: null,
          maker: mgr,
          creator: addr(l.data, 0).toLowerCase(),
          launchpad: "Four.Meme",
          ours: false,
          created_block: b,
          created_at: at,
          price_hype: null,
        });
      } else if (t0 === T.buy || t0 === T.sell) {
        const token = addr(l.data, 0).toLowerCase();
        const account = addr(l.data, 1).toLowerCase();
        const amount = big(l.data, 3);
        const cost = big(l.data, 4);
        if (amount === 0n || cost === 0n) continue;
        if (!store.tokens().get(token) && !(await isBnb(token))) continue;
        if (skip.has(token)) continue;
        const isBuy = t0 === T.buy;
        const price = Number(cost) / Number(amount); // BNB per token (both 18 decimals)
        trades.push({ token, tx: l.transactionHash, log_index: Number(BigInt(l.logIndex)), block: b, at, side: isBuy ? "buy" : "sell", hype: Number(cost) / 1e18, amount: Number(amount) / 1e18, price_hype: price, trader: account });
        moves.push({ token, from: isBuy ? ZERO : account, to: isBuy ? account : ZERO, value: amount.toString() });
        lastPrice.set(token, price);
      } else if (t0 === T.graduated) {
        const token = addr(l.data, 0).toLowerCase();
        await store.setState(`fm_grad_${token}`, b);
      }
    }
    // a coin we never saw created (the scan started later): make it from its trade, details are read from the chain
    for (const x of trades) {
      if (store.tokens().get(x.token)) continue;
      const call = async (data) => rpc("eth_call", [{ to: x.token, data }, "latest"]).catch(() => null);
      const [n, s, ts] = await Promise.all([call("0x06fdde03"), call("0x95d89b41"), call("0x18160ddd")]);
      const dec = (r) => { try { const off = Number(BigInt("0x" + r.slice(2, 66))) * 2 + 2; const len = Number(BigInt("0x" + r.slice(off, off + 64))); return Buffer.from(r.slice(off + 64, off + 64 + len * 2), "hex").toString("utf8").trim(); } catch { return null; } };
      await store.upsertToken({
        address: x.token, name: n ? dec(n) : null, symbol: s ? dec(s) : null, decimals, supply: ts ? BigInt(ts).toString() : "1000000000000000000000000000",
        uri: null, venue: "fourmeme", pool: mgr, manager: mgr, whype: ZERO, token_is0: false, fee: 100, tick_spacing: null, hooks: null, maker: mgr, creator: null,
        launchpad: "Four.Meme", ours: false, created_block: x.block, created_at: x.at, price_hype: null,
      });
    }
    // coins created this batch must exist before their trades
    if (trades.length) await store.addTrades(trades);
    if (moves.length) await store.applyTransfers(moves);
    for (const [token, price] of lastPrice) {
      const t = store.tokens().get(token);
      if (t) await store.upsertToken({ ...t, price_hype: price });
    }
    return trades.length;
  }

  // once at start: drop coins listed earlier that turn out to be quoted in another token
  (async () => {
    for (const t of [...store.tokens().values()].filter((x) => x.venue === "fourmeme")) {
      if (!(await isBnb(t.address)) && skip.has(t.address)) { await store.removeToken(t.address).catch(() => {}); log(`bnb: Four.Meme removed ${t.symbol} (not BNB-quoted)`); }
    }
  })().catch(() => {});

  for (;;) {
    try {
      const tip = Number(BigInt(await rpc("eth_blockNumber")));
      let last = Number((await store.getState("fm_block")) ?? -1);
      if (last < 0) { last = tip - back; await store.setState("fm_block", last); log(`bnb: Four.Meme reading from block ${last}`); }
      let span = 400;
      let n = 0;
      while (last < tip) {
        const to = Math.min(tip, last + span);
        let logs;
        try {
          logs = await getLogs({ fromBlock: hex(last + 1), toBlock: hex(to), address: mgr, topics: [[T.create, T.buy, T.sell, T.graduated]] });
        } catch (e) {
          if (span > 20) { span = Math.max(20, Math.floor(span / 2)); await sleep(300); continue; }
          throw e;
        }
        logs.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(BigInt(a.logIndex)) - Number(BigInt(b.logIndex)));
        n += await handle(logs);
        last = to;
        await store.setState("fm_block", last);
        if (span < 2000) span = Math.min(2000, Math.ceil(span * 1.5));
      }
      pictures().catch(() => {});
      if (n) log(`bnb: Four.Meme ${n} trades (block ${last}, ${[...store.tokens().values()].filter((t) => t.venue === "fourmeme").length} coins)`);
    } catch (e) {
      log(`bnb: Four.Meme ${e.message}`);
      await sleep(15_000);
    }
    await sleep(2500);
  }
}
