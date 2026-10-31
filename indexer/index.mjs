// ArkhamPad indexer: reads coin launches, pool trades (from every app) and
// promotions from every configured chain and writes them to Postgres (Supabase).
// v2: every coin opens straight into its locked Uniswap v4 pool at launch; there is
// no bonding curve. coins.curve holds the coin's pool id, coins.phase is always 2.
// Env: DATABASE_URL, one RPC URL per chain (see chains.json -> rpcEnv),
//      optional CHAINS_FILE, POLL_SECONDS (overrides chains.json pollSeconds), BLOCK_RANGE (overrides chains.json blockRange).
import fs from "node:fs";
import http from "node:http";
import pg from "pg";
import { createPublicClient, http as viemHttp, fallback as viemFallback, parseAbiItem, getAddress } from "viem";
import { startMarkets } from "./markets.mjs";
import { startQuality } from "./quality.mjs";
import { startDexWatch } from "./dexwatch.mjs";
import { makeRelayer, httpHandler } from "./relayer.mjs";
import { poolIdOf, poolTrade, clankerTrade } from "./poolmath.mjs";
import { makeNotifier } from "./notify.mjs";
import { makeOg } from "./og.mjs";
import { announce as indexNow, coinPath, startIndexNow } from "./indexnow.mjs";
import { makeFees } from "./fees.mjs";
import { CLANKER_CHAINS, TOKEN_CREATED, clankerOf, lockersOf, mcAtTick } from "./clanker.mjs";
import { makeElysium } from "./elysium.mjs";
import { makePgStore } from "./elysium-pg.mjs";
const relayer = process.env.ONCE || process.env.ELY_ONLY === "1" ? null : makeRelayer();
// ETH / BNB prices in dollars, for coins paired with the chain's own coin (Clanker launches)
const prices = makeFees({ log: (...a) => console.log(new Date().toISOString(), ...a) });
/** The wallet that launches ArkhamPad's Clanker coins (the relayer). */
const LAUNCHER = (relayer?.address ?? process.env.LAUNCHER_ADDRESS ?? "").toLowerCase();
const CLANKER_SUPPLY = 100_000_000_000;

const POLL_DEFAULT = process.env.POLL_SECONDS ? Number(process.env.POLL_SECONDS) * 1000 : null;
const RANGE_DEFAULT = process.env.BLOCK_RANGE ? BigInt(process.env.BLOCK_RANGE) : null;
// ELY_ONLY=1: Elysium only. The old Base / Robinhood / BNB jobs (chain indexing, markets, quality checks,
// dex watch, fee sweeps) stay off, which saves most of the Railway usage.
const ELY_ONLY = process.env.ELY_ONLY === "1";
const CHAINS = ELY_ONLY ? [] : JSON.parse(fs.readFileSync(process.env.CHAINS_FILE || new URL("./chains.json", import.meta.url), "utf8"));
const SUPPLY = 1_000_000_000; // every coin has a fixed 1B supply

const EV = {
  created: parseAbiItem("event CoinCreated(address indexed coin, address indexed creator, string name, string symbol, string metadataURI, uint256 lockSeconds, uint8 feeMode)"),
  promoted: parseAbiItem("event Promoted(address indexed coin, uint256 indexed chainId, address indexed payer, uint8 plan, uint256 seconds_, uint256 price)"),
  // router events name the real user behind a gasless trade
  rpromoted: parseAbiItem("event Promoted(address indexed user, address indexed coin, uint8 plan, uint256 fee, uint256 nonce)"),
  ptraded: parseAbiItem("event PoolTraded(address indexed user, address indexed coin, bool isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 fee, uint256 nonce)"),
  // Uniswap v4 PoolManager: amounts are from the swapper's side (negative = paid in)
  transfer: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
  swap: parseAbiItem("event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)"),
  // PadExtSwap: the ArkhamPad user behind a one-tap trade of a coin on another DEX (or a Clanker coin)
  extSwapped: parseAbiItem("event ExtSwapped(address indexed user, address indexed coin, bool isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 tradeFee, uint256 networkFee, uint256 nonce)"),
};

/** Creator details for the site, from a Clanker coin's on-chain metadata (when the relayer's row is missing). */
function clankerMetaUri(raw) {
  try {
    const j = JSON.parse(raw || "{}");
    const desc = String(j.description ?? "").replace(/\n*Launched on ArkhamPad\s*$/, "").slice(0, 280);
    const find = (p) => (Array.isArray(j.socialMediaUrls) ? j.socialMediaUrls.find((x) => x?.platform === p)?.url : undefined);
    const meta = { description: desc || undefined, x: find("x"), telegram: find("telegram") };
    return `data:application/json;base64,${Buffer.from(JSON.stringify(meta)).toString("base64")}`;
  } catch { return ""; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Dollar amounts from the chain's dollar token (6 decimals for USDC/USDG, 18 on BNB). */
const usdOf = (c) => (x) => Number(x) / 10 ** (c.usdDecimals ?? 6);
const tok = (x) => Number(x) / 1e18;
const lc = (a) => a.toLowerCase();
const log = (...a) => console.log(new Date().toISOString(), ...a);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "") ? false : { rejectUnauthorized: false },
  max: 4,
});
const notifier = makeNotifier(pool);
const BURN = "0x000000000000000000000000000000000000dead";
const HUB_ABI = [{ type: "function", name: "startMarketCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }];
if (relayer) { relayer.setDb(pool); relayer.setNotifier(notifier); relayer.setOg(makeOg(pool)); }

// After each indexed batch: tell followers about fresh buys.
async function announce(c, fresh) {
  for (const f of fresh) {
    if (Date.now() - f.at.getTime() > 10 * 60_000) continue; // catching up on old blocks: stay quiet
    if (f.type === "buy") {
      const { rows } = await pool.query("select follower from follows where trader=$1 limit 500", [f.trader]);
      if (!rows.length) continue;
      const sym = (await pool.query("select symbol from coins where chain_id=$1 and address=$2", [c.chainId, f.coin])).rows[0]?.symbol ?? "a coin";
      await notifier.notifyMany(rows.map((r) => r.follower), { kind: "follow", title: `${f.trader.slice(0, 6)}…${f.trader.slice(-4)} bought ${sym}`, body: `$${f.usdc.toFixed(2)} of ${sym}. Tap to see it and copy.`, url: `/coin/?c=${c.chainId}-${f.coin}` });
    }
  }
}

// Coins belong to one hub. When chains.json points at a new hub (a redeploy), the old
// deployment's coins, trades and everything tied to them are removed once, and indexing
// restarts from the new hub's first block.
const TIED = ["trades", "promotions", "orders", "price_alerts", "comments", "coin_images", "coin_transfers", "transfer_sync", "coins"];
async function lastBlock(c) {
  const hub = c.hub.toLowerCase();
  const r = await pool.query("select last_block, hub from sync_state where chain_id = $1", [c.chainId]);
  const row = r.rows[0];
  if (row && row.hub && row.hub.toLowerCase() === hub) return BigInt(row.last_block);
  const db = await pool.connect();
  try {
    await db.query("begin");
    if (row) {
      for (const t of TIED) {
        const d = await db.query(`delete from ${t} where chain_id=$1`, [c.chainId]);
        if (d.rowCount) log(`${c.name}: new hub, removed ${d.rowCount} old rows from ${t}`);
      }
    }
    await db.query("insert into sync_state (chain_id, last_block, hub) values ($1,$2,$3) on conflict (chain_id) do update set last_block=excluded.last_block, hub=excluded.hub, updated_at=now()", [c.chainId, String(c.startBlock - 1), hub]);
    await db.query("commit");
  } catch (e) { await db.query("rollback"); throw e; } finally { db.release(); }
  log(`${c.name}: indexing hub ${c.hub} from block ${c.startBlock}`);
  return BigInt(c.startBlock - 1);
}

async function syncChain(c, client) {
  const usd = usdOf(c);
  const RANGE = RANGE_DEFAULT ?? BigInt(c.blockRange || 500);
  const tip = await client.getBlockNumber().catch((err) => { throw new Error(`getBlockNumber: ${err.shortMessage || err.message}${err.details ? " | " + err.details : ""}`); });
  // Load-balanced public RPCs (BNB) answer from nodes a block or two apart: stay a few blocks
  // behind the tip so getLogs never asks a lagging node for a block it doesn't have yet.
  const head = tip - BigInt(c.headLag || 0);
  // the cursor is read once and then kept in memory, so a stale process can't move it
  if (c.cursor === undefined) {
    c.cursor = await lastBlock(c);
    // FROM_<chainId>: skip ahead to this block (e.g. after an RPC outage, when the gap can't be
    // read back from a free node). Only ever moves forward; a saved cursor past it wins.
    const floor = BigInt(process.env[`FROM_${c.chainId}`] || "0");
    if (floor > 0n && c.cursor < floor - 1n) {
      log(`${c.name}: skipping ahead from block ${c.cursor + 1n} to ${floor} (FROM_${c.chainId})`);
      c.cursor = floor - 1n;
    }
  }
  let from = c.cursor + 1n;
  while (from <= head) {
    const to = from + RANGE - 1n > head ? head : from + RANGE - 1n;
    // One labelled call at a time, so an RPC error says exactly which request failed.
    // Rate limits (HTTP 429) are waited out with growing pauses; other errors stop the round.
    const call = async (label, fn) => {
      for (let attempt = 0; ; attempt++) {
        try { return await fn(); }
        catch (err) {
          const text = `${err.shortMessage || err.message} ${err.details || ""}`;
          if (/too many requests|429|rate limit|exceeded/i.test(text) && attempt < 8) {
            await sleep(Math.min(30_000, 1000 * 2 ** attempt));
            continue;
          }
          throw new Error(`${label} [${from}-${to}]: ${err.shortMessage || err.message}${err.details ? " | " + err.details : ""}`);
        }
      }
    };
    // One getLogs call for everything we watch (hub + promote + our coins' Transfer
    // events for the holder map), which keeps RPC usage low.
    // Clanker launches: the factory's TokenCreated rides along in the same request
    const clanker = CLANKER_CHAINS.includes(c.chainId) && LAUNCHER ? clankerOf(c.chainId) : null;
    const ALL = [EV.created, EV.promoted, EV.transfer, ...(clanker ? [TOKEN_CREATED] : [])];
    const knownRows = (await pool.query("select address from coins where chain_id=$1", [c.chainId])).rows;
    const tokens = knownRows.map((r) => getAddress(r.address));
    const watched = [c.hub, ...(c.promote ? [c.promote] : []), ...(clanker ? [clanker.factory] : []), ...tokens];
    let logs = [];
    for (let i = 0; i < watched.length; i += 500) {
      const address = watched.slice(i, i + 500);
      logs = logs.concat(await call("getLogs", () => client.getLogs({ address, events: ALL, fromBlock: from, toBlock: to })));
    }
    const routerLogs = c.router ? await call("getLogs router", () => client.getLogs({ address: c.router, events: [EV.rpromoted, EV.ptraded], fromBlock: from, toBlock: to })) : [];
    const isHub = (e) => lc(e.address) === lc(c.hub);
    const created = logs.filter((e) => e.eventName === "CoinCreated" && isHub(e));
    // only coins ArkhamPad launched (sent by our launcher, interface "ArkhamPad")
    const clankerCreated = clanker ? logs.filter((e) => {
      if (e.eventName !== "TokenCreated" || lc(e.address) !== lc(clanker.factory) || lc(e.args.msgSender) !== LAUNCHER) return false;
      try { return JSON.parse(e.args.tokenContext).interface === "ArkhamPad"; } catch { return false; }
    }) : [];
    const freshTokens = [...created.map((e) => getAddress(e.args.coin)), ...clankerCreated.map((e) => getAddress(e.args.tokenAddress))].filter((a) => !tokens.includes(a));
    if (freshTokens.length) logs = logs.concat(await call("getLogs new tokens", () => client.getLogs({ address: freshTokens, event: EV.transfer, fromBlock: from, toBlock: to })));
    const tokenSet = new Set([...tokens, ...freshTokens].map(lc));
    const transfers = logs.filter((e) => e.eventName === "Transfer" && tokenSet.has(lc(e.address)));
    const promos = c.promote ? logs.filter((e) => e.eventName === "Promoted" && lc(e.address) === lc(c.promote)) : [];
    const promoPayer = new Map();
    for (const e of routerLogs) if (e.eventName === "Promoted") promoPayer.set(e.transactionHash, lc(e.args.user));
    const blocks = new Map();
    const ts = async (bn) => {
      if (!blocks.has(bn)) blocks.set(bn, new Date(Number((await call("getBlock", () => client.getBlock({ blockNumber: bn }))).timestamp) * 1000));
      return blocks.get(bn);
    };
    const db = await pool.connect();
    try {
      await db.query("begin");
      // The launch market cap is the same for every coin on a hub: read it once.
      if (created.length && c.startMc === undefined) c.startMc = usd(await call("startMarketCap", () => client.readContract({ address: c.hub, abi: HUB_ABI, functionName: "startMarketCap" })));
      for (const e of created) {
        const a = e.args;
        const at = await ts(e.blockNumber);
        const id = c.usdc && c.guard ? poolIdOf(c.usdc, a.coin, c.guard) : a.coin; // pool id (unique per coin)
        await db.query(
          `insert into coins (chain_id, address, curve, creator, name, symbol, metadata_uri, lock_seconds, fee_mode, phase, price_usd, mc_usd, start_mc_usd,
                              created_block, created_tx, created_at, graduated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,2,$10,$11,$11,$12,$13,$14,$14) on conflict (chain_id, address) do nothing`,
          [c.chainId, lc(a.coin), lc(id), lc(a.creator), a.name, a.symbol, a.metadataURI, Number(a.lockSeconds), Number(a.feeMode),
           c.startMc / SUPPLY, c.startMc, String(e.blockNumber), e.transactionHash, at],
        );
        // an image the creator uploaded before the coin was indexed
        await db.query(
          `update coins set image_url = $3 || '/img/' || $1::text || '-' || $2 || '?v=' || extract(epoch from i.updated_at)::bigint::text
             from coin_images i where coins.chain_id=$1 and coins.address=$2 and coins.image_url is null and i.chain_id=$1 and i.coin=$2`,
          [c.chainId, lc(a.coin), (process.env.PUBLIC_URL || "https://arkhampad-web-production.up.railway.app").replace(/\/$/, "")],
        ).catch((err) => log(`${c.name}: image attach: ${err.message}`));
      }
      // Clanker coins (the relayer normally saved the row already: then nothing changes here)
      for (const e of clankerCreated) {
        const a = e.args;
        const at = await ts(e.blockNumber);
        const native = await prices.nativeUsd(c.native ?? "ETH");
        const startMc = mcAtTick(Number(a.startingTick), native);
        const key = (() => { try { const m = String(JSON.parse(a.tokenContext).messageId ?? "").match(/[?&]k=\d+-([0-9a-f]{16})/); return m ? m[1] : null; } catch { return null; } })();
        await db.query(
          `insert into coins (chain_id, address, curve, creator, name, symbol, metadata_uri, lock_seconds, fee_mode, phase, price_usd, mc_usd, start_mc_usd,
                              created_block, created_tx, created_at, graduated_at, venue, supply, paired, launch_key, image_url)
           values ($1,$2,$3,$4,$5,$6,$7,0,0,2,$8,$9,$9,$10,$11,$12,$12,'clanker',$13,$14,$15,$16) on conflict (chain_id, address) do nothing`,
          [c.chainId, lc(a.tokenAddress), lc(a.poolId), lc(a.tokenAdmin), a.tokenName, a.tokenSymbol, clankerMetaUri(a.tokenMetadata), startMc / CLANKER_SUPPLY, startMc,
           String(e.blockNumber), e.transactionHash, at, CLANKER_SUPPLY, lc(a.pairedToken), key, /^https:\/\//.test(a.tokenImage) ? a.tokenImage.slice(0, 300) : null],
        );
      }
      const fresh = []; // buys to announce once this batch is saved
      for (const e of promos) {
        const a = e.args;
        const at = await ts(e.blockNumber);
        await db.query(
          `insert into promotions (chain_id, tx_hash, log_index, coin, coin_chain_id, payer, plan, seconds, price_usd, starts_at, ends_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing`,
          [c.chainId, e.transactionHash, e.logIndex, lc(a.coin), String(a.chainId), promoPayer.get(e.transactionHash) ?? lc(a.payer), Number(a.plan), Number(a.seconds_), usd(a.price), at, new Date(at.getTime() + Number(a.seconds_) * 1000)],
        );
      }
      // Trades in every coin's locked Uniswap pool, from any app (ArkhamPad, aggregators, bots).
      let poolTrades = 0;
      if (c.poolManager && c.guard && c.usdc) {
        const all = (await db.query("select address, creator, created_tx, curve, venue, paired, supply from coins where chain_id=$1", [c.chainId])).rows;
        if (all.length) {
          // our own pools are found from the coin; Clanker pools by the pool id saved at launch
          const byId = new Map(all.map((r) => [r.venue === "clanker" ? lc(r.curve) : lc(poolIdOf(c.usdc, r.address, c.guard)), r]));
          let extUsers = null; // tx -> ArkhamPad user, for one-tap trades of Clanker coins (read once per range)
          const native = all.some((r) => r.venue === "clanker") ? await prices.nativeUsd(c.native ?? "ETH") : 0;
          const clankerLockers = new Set(CLANKER_CHAINS.includes(c.chainId) ? lockersOf(c.chainId).map(lc) : []);
          const ids = [...byId.keys()];
          const viaPool = new Map();
          for (const e of routerLogs) if (e.eventName === "PoolTraded") viaPool.set(`${e.transactionHash}:${lc(e.args.coin)}`, lc(e.args.user));
          const txFrom = new Map(); // other apps: the wallet that sent the transaction
          const txTo = new Map(); // ...and the contract it called (Clanker coins)
          for (let i = 0; i < ids.length; i += 100) {
            const swaps = await call("getLogs pools", () => client.getLogs({ address: c.poolManager, event: EV.swap, args: { id: ids.slice(i, i + 100) }, fromBlock: from, toBlock: to }));
            for (const e of swaps) {
              const r = byId.get(lc(e.args.id));
              if (!r) continue;
              const isClanker = r.venue === "clanker";
              // Clanker's locker swaps the coin side of collected fees into WETH/WBNB inside the pool:
              // bookkeeping, not a trade
              if (isClanker && clankerLockers.has(lc(e.args.sender))) continue;
              let t;
              if (isClanker) {
                // paired with WETH / WBNB (18 decimals): amounts and price in the chain's coin, then dollars
                t = clankerTrade(e.args, r.address, r.paired, native);
              } else {
                const usdcIs0 = BigInt(c.usdc) < BigInt(r.address);
                t = poolTrade(e.args, usdcIs0, c.usdDecimals ?? 6);
              }
              const supply = Number(r.supply) || SUPPLY;
              const sender = lc(e.args.sender);
              let trader, via;
              if (isClanker && lc(e.transactionHash) === lc(r.created_tx)) {
                trader = r.creator; via = "launch"; // the creator's first buy, inside the launch
              } else if (isClanker) {
                if (!txFrom.has(e.transactionHash)) {
                  const tx = await call("getTransaction", () => client.getTransaction({ hash: e.transactionHash }));
                  txFrom.set(e.transactionHash, lc(tx.from));
                  if (tx.to) txTo.set(e.transactionHash, lc(tx.to));
                }
                // someone asked the locker to collect fees: it swaps them through the Universal
                // Router, which looks like a trade but is bookkeeping
                if (clankerLockers.has(txTo.get(e.transactionHash) ?? "")) continue;
                trader = txFrom.get(e.transactionHash);
                via = "external";
                if (LAUNCHER && trader === LAUNCHER && c.extSwap) {
                  // sent by our relayer: a one-tap trade on ArkhamPad; the event names the user
                  if (!extUsers) {
                    extUsers = new Map();
                    const xs = await call("getLogs extSwap", () => client.getLogs({ address: getAddress(c.extSwap), event: EV.extSwapped, fromBlock: from, toBlock: to }));
                    for (const x of xs) extUsers.set(`${x.transactionHash}:${lc(x.args.coin)}`, lc(x.args.user));
                  }
                  const u = extUsers.get(`${e.transactionHash}:${r.address}`);
                  if (u) { trader = u; via = "arkhampad"; }
                }
              } else if (c.router && sender === lc(c.router)) {
                trader = viaPool.get(`${e.transactionHash}:${r.address}`) ?? sender;
                via = "arkhampad";
              } else if (c.poolBuilder && sender === lc(c.poolBuilder)) {
                // the builder swaps for two reasons: the creator's launch buy and buybacks
                const launch = lc(e.transactionHash) === lc(r.created_tx);
                trader = launch ? r.creator : BURN;
                via = launch ? "launch" : "buyback";
              } else {
                if (!txFrom.has(e.transactionHash)) {
                  const tx = await call("getTransaction", () => client.getTransaction({ hash: e.transactionHash }));
                  txFrom.set(e.transactionHash, lc(tx.from));
                }
                trader = txFrom.get(e.transactionHash);
                via = "external";
              }
              const at = await ts(e.blockNumber);
              const ins = await db.query(
                `insert into trades (chain_id, tx_hash, log_index, coin, trader, is_buy, usdc, coins, fee, price_usd, mc_usd, block, ts, via)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict do nothing`,
                [c.chainId, e.transactionHash, e.logIndex, r.address, trader, t.isBuy, t.usdc, t.coins, t.fee, t.price, t.price * supply, String(e.blockNumber), at, via],
              );
              if (ins.rowCount && t.isBuy && via !== "buyback") fresh.push({ type: "buy", trader, coin: r.address, usdc: t.usdc, at });
              if (ins.rowCount) {
                poolTrades++;
                await db.query("update coins set price_usd=$3, mc_usd=$4, trades_count=trades_count+1, volume_usd=volume_usd+$5, last_trade_at=$6 where chain_id=$1 and address=$2",
                  [c.chainId, r.address, t.price, t.price * supply, t.usdc, at]);
              }
            }
          }
        }
      }
      for (const e of transfers) await saveTransfer(db, c, e);
      // new coin pages go to search engines right away (IndexNow)
      for (const e of created) indexNow(coinPath(c.chainId, e.args.coin));
      for (const e of clankerCreated) indexNow(coinPath(c.chainId, e.args.tokenAddress));
      await db.query("update sync_state set last_block=$2, updated_at=now() where chain_id=$1 and hub=$3", [c.chainId, String(to), c.hub.toLowerCase()]);
      await db.query("commit");
      if (fresh.length) announce(c, fresh).catch((e) => log(`${c.name}: announce error ${e.message}`));
      if (created.length || clankerCreated.length || promos.length || poolTrades)
        log(`${c.name}: blocks ${from}-${to} coins+${created.length + clankerCreated.length} trades+${poolTrades} promos+${promos.length}`);
    } catch (err) {
      await db.query("rollback");
      throw err;
    } finally {
      db.release();
    }
    c.cursor = to;
    from = to + 1n;
    if (c.rangeDelayMs) await sleep(c.rangeDelayMs); // stay under the RPC's requests-per-second limit
  }
}

const status = {};
/** One token Transfer (coin moved between wallets). Mints from 0x0 count as the first transfer. */
async function saveTransfer(db, c, e) {
  await db.query(
    `insert into coin_transfers (chain_id, coin, tx_hash, log_index, "from", "to", amount, block) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing`,
    [c.chainId, lc(e.address), e.transactionHash, e.logIndex, lc(e.args.from), lc(e.args.to), tok(e.args.value), String(e.blockNumber)],
  );
}

/**
 * Transfers that happened before the holder map existed: read them in the background, a few
 * block ranges per round, from the deployment's start block up to where live indexing began.
 */
async function backfillTransfers(c, client) {
  if (c.cursor === undefined) return;
  const hub = c.hub.toLowerCase();
  let st = (await pool.query("select * from transfer_sync where chain_id=$1", [c.chainId])).rows[0];
  if (!st || st.hub !== hub) {
    await pool.query("delete from transfer_sync where chain_id=$1", [c.chainId]);
    await pool.query("insert into transfer_sync (chain_id, hub, next_block, until_block) values ($1,$2,$3,$4)", [c.chainId, hub, c.startBlock, String(c.cursor)]);
    st = { next_block: String(c.startBlock), until_block: String(c.cursor), done: false };
  }
  if (st.done) return;
  const RANGE = BigInt(c.blockRange || 500);
  let next = BigInt(st.next_block);
  const until = BigInt(st.until_block);
  const tokens = (await pool.query("select address from coins where chain_id=$1", [c.chainId])).rows.map((r) => getAddress(r.address));
  for (let round = 0; round < 12 && next <= until; round++) {
    const to = next + RANGE - 1n > until ? until : next + RANGE - 1n;
    let logs = [];
    for (let i = 0; i < tokens.length; i += 500) logs = logs.concat(await client.getLogs({ address: tokens.slice(i, i + 500), event: EV.transfer, fromBlock: next, toBlock: to }));
    const db = await pool.connect();
    try {
      await db.query("begin");
      for (const e of logs) await saveTransfer(db, c, e);
      await db.query("update transfer_sync set next_block=$2, done=$3 where chain_id=$1", [c.chainId, String(to + 1n), to + 1n > until]);
      await db.query("commit");
    } catch (err) { await db.query("rollback").catch(() => {}); throw err; } finally { db.release(); }
    if (logs.length) log(`${c.name}: holder map backfill ${next}-${to} transfers+${logs.length}`);
    next = to + 1n;
  }
  if (next > until) log(`${c.name}: holder map backfill complete`);
}

async function loop(c) {
  const rpc = (process.env[c.rpcEnv] || "").trim();
  if (!rpc) { log(`${c.name}: ${c.rpcEnv} not set, skipped`); return; }
  // several RPC URLs may be given, comma-separated: the next one answers when one fails
  // (e.g. a free node that only serves recent blocks, or one behind a Cloudflare challenge)
  const urls = rpc.split(",").map((u) => u.trim()).filter(Boolean);
  const client = createPublicClient({ transport: urls.length > 1 ? viemFallback(urls.map((u) => viemHttp(u, { retryCount: 1, timeout: 20_000 }))) : viemHttp(rpc, { retryCount: 3, timeout: 20_000 }) });
  c.hub = getAddress(c.hub);
  if (c.promote) c.promote = getAddress(c.promote);
  if (c.router) c.router = getAddress(c.router);
  if (c.poolManager) c.poolManager = getAddress(c.poolManager);
  if (c.poolBuilder) c.poolBuilder = getAddress(c.poolBuilder);
  if (!c.poolManager || !c.guard || !c.usdc) log(`${c.name}: poolManager, guard (the launch hook) and usdc are needed to read trades`);
  log(`${c.name}: indexing from block ${c.startBlock}`);
  for (;;) {
    try {
      await syncChain(c, client);
      await backfillTransfers(c, client).catch((err) => log(`${c.name}: holder map backfill paused: ${err.shortMessage || err.message}`));
      status[c.name] = { ok: true, at: new Date().toISOString() };
    } catch (err) {
      status[c.name] = { ok: false, at: new Date().toISOString(), error: String(err.shortMessage || err.message) };
      log(`${c.name}: error`, err.shortMessage || err.message);
      if (process.env.ONCE) { process.exitCode = 1; return; }
    }
    if (process.env.ONCE) return;
    await new Promise((r) => setTimeout(r, POLL_DEFAULT ?? (c.pollSeconds || 5) * 1000));
  }
}

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
if (process.env.PORT) http.createServer(httpHandler(relayer, status)).listen(process.env.PORT);
if (!process.env.ONCE && !ELY_ONLY) { startMarkets(pool); startQuality(pool, CHAINS.map((c) => ({ chainId: c.chainId, rpc: (process.env[c.rpcEnv] || "").trim(), usdc: c.usdc, usdcDec: c.usdDecimals ?? 6, route: c.clankerRoute ?? null }))); startIndexNow(); startDexWatch(pool, { log, notifier }); }
// platform fees into the vault, creator payouts, pool fees and referral rewards: every 30 minutes
if (relayer && !ELY_ONLY) {
  const sweep = () => relayer.sweepFees().catch((e) => console.log(new Date().toISOString(), `fee sweep: ${e.message}`));
  setTimeout(sweep, 90_000);
  setInterval(sweep, Number(process.env.SWEEP_MINUTES || 30) * 60_000);
}
// Elysium: every HYPE-paired token from every launchpad (db/025_elysium.sql). Env: ELYSIUM_RPC
// (comma-separated for fallbacks), ELY_LAUNCHER (ArkhamPad's launcher, from contracts-elysium/deployments/99901.json).
async function elysiumLoop() {
  const rpc = (process.env.ELYSIUM_RPC || "").trim();
  if (!rpc || process.env.ONCE) return;
  let launcher = (process.env.ELY_LAUNCHER || "").trim();
  // ArkhamPad's own pool factory (for the fast lane); mainnet's from the deploy record
  let factory = (process.env.ELY_FACTORY || "0x75656d8d2a59293dbda4178f11af6ee506ef60dd").trim().toLowerCase();
  try {
    const d = JSON.parse(fs.readFileSync(new URL("../contracts-elysium/deployments/99901.json", import.meta.url), "utf8"));
    if (!launcher) launcher = d.launcher || "";
    if (d.factory) factory = String(d.factory).toLowerCase();
  } catch {}
  const key = (process.env.KEEPER_KEY || "").trim();
  if (key && launcher) {
    import("./elykeeper.mjs").then(({ keeperLoop }) => keeperLoop({ rpc, launcher, key, pool, log })).catch((e) => log(`keeper: ${e.message}`));
  }
  for (;;) {
    try {
      const store = await makePgStore(pool);
      await makeElysium({ rpc, launcher, factory, log }, store).loop();
    } catch (e) {
      log(`elysium: ${e.message}; restarting in 30 s`);
      await sleep(30_000);
    }
  }
}
await Promise.all([...CHAINS.map(loop), elysiumLoop()]);
if (process.env.ONCE) await pool.end();
