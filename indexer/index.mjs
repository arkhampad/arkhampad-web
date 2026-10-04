// ArkhamPad indexer: reads coin launches, curve trades, graduations and
// promotions from every configured chain and writes them to Postgres (Supabase).
// Env: DATABASE_URL, one RPC URL per chain (see chains.json -> rpcEnv),
//      optional CHAINS_FILE, POLL_SECONDS (overrides chains.json pollSeconds), BLOCK_RANGE (overrides chains.json blockRange).
import fs from "node:fs";
import http from "node:http";
import pg from "pg";
import { createPublicClient, http as viemHttp, parseAbiItem, getAddress } from "viem";
import { startMarkets } from "./markets.mjs";
import { makeRelayer, httpHandler } from "./relayer.mjs";
import { poolIdOf, poolTrade } from "./poolmath.mjs";
const relayer = process.env.ONCE ? null : makeRelayer();

const POLL_DEFAULT = process.env.POLL_SECONDS ? Number(process.env.POLL_SECONDS) * 1000 : null;
const RANGE_DEFAULT = process.env.BLOCK_RANGE ? BigInt(process.env.BLOCK_RANGE) : null;
const CHAINS = JSON.parse(fs.readFileSync(process.env.CHAINS_FILE || new URL("./chains.json", import.meta.url), "utf8"));
const SUPPLY = 1_000_000_000; // every coin has a fixed 1B supply

const EV = {
  created: parseAbiItem("event CoinCreated(address indexed coin, address indexed curve, address indexed creator, string name, string symbol, string metadataURI, uint256 lockSeconds, uint8 feeMode)"),
  trade: parseAbiItem("event Trade(address indexed trader, bool indexed isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 fee, uint256 vUsdcAfter, uint256 vCoinAfter)"),
  full: parseAbiItem("event CurveFull(uint256 usdcReserve)"),
  graduated: parseAbiItem("event Graduated(uint256 usdcToPool, uint256 coinsToPool, uint256 coinsBurned, uint256 graduationFee)"),
  promoted: parseAbiItem("event Promoted(address indexed coin, uint256 indexed chainId, address indexed payer, uint8 plan, uint256 seconds_, uint256 price)"),
  // router events name the real user behind a gasless trade
  bought: parseAbiItem("event Bought(address indexed user, address indexed curve, uint256 usdcSpent, uint256 coinsOut, uint256 fee, uint256 nonce)"),
  sold: parseAbiItem("event Sold(address indexed user, address indexed curve, uint256 coinAmount, uint256 usdcOut, uint256 fee, uint256 nonce)"),
  rpromoted: parseAbiItem("event Promoted(address indexed user, address indexed coin, uint8 plan, uint256 fee, uint256 nonce)"),
  ptraded: parseAbiItem("event PoolTraded(address indexed user, address indexed coin, bool isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 fee, uint256 nonce)"),
  // Uniswap v4 PoolManager: amounts are from the swapper's side (negative = paid in)
  swap: parseAbiItem("event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)"),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usd = (x) => Number(x) / 1e6;
const tok = (x) => Number(x) / 1e18;
const lc = (a) => a.toLowerCase();
const log = (...a) => console.log(new Date().toISOString(), ...a);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "") ? false : { rejectUnauthorized: false },
  max: 4,
});

async function lastBlock(chainId, start) {
  const r = await pool.query("select last_block from sync_state where chain_id = $1", [chainId]);
  if (r.rows.length) return BigInt(r.rows[0].last_block);
  await pool.query("insert into sync_state (chain_id, last_block) values ($1, $2) on conflict do nothing", [chainId, String(start - 1)]);
  return BigInt(start - 1);
}


async function syncChain(c, client) {
  const RANGE = RANGE_DEFAULT ?? BigInt(c.blockRange || 500);
  const head = await client.getBlockNumber().catch((err) => { throw new Error(`getBlockNumber: ${err.shortMessage || err.message}${err.details ? " | " + err.details : ""}`); });
  let from = (await lastBlock(c.chainId, c.startBlock)) + 1n;
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
    // One getLogs call for everything we watch (hub + promote + our curves), which
    // keeps RPC usage low. Curves created inside this range get a second call.
    const ALL = [EV.created, EV.trade, EV.full, EV.graduated, EV.promoted];
    const CURVE_EVENTS = [EV.trade, EV.full, EV.graduated];
    const known = (await pool.query("select curve from coins where chain_id=$1", [c.chainId])).rows.map((r) => getAddress(r.curve));
    const watched = [c.hub, ...(c.promote ? [c.promote] : []), ...known];
    let logs = [];
    for (let i = 0; i < watched.length; i += 500) {
      const address = watched.slice(i, i + 500);
      logs = logs.concat(await call("getLogs", () => client.getLogs({ address, events: ALL, fromBlock: from, toBlock: to })));
    }
    const routerLogs = c.router ? await call("getLogs router", () => client.getLogs({ address: c.router, events: [EV.bought, EV.sold, EV.rpromoted, EV.ptraded], fromBlock: from, toBlock: to })) : [];
    // tx hash + curve -> the user who signed a gasless trade
    const viaRouter = new Map();
    for (const e of routerLogs) if (e.eventName === "Bought" || e.eventName === "Sold") viaRouter.set(`${e.transactionHash}:${lc(e.args.curve)}`, lc(e.args.user));
    const isHub = (e) => lc(e.address) === lc(c.hub);
    const created = logs.filter((e) => e.eventName === "CoinCreated" && isHub(e));
    const fresh = created.map((e) => getAddress(e.args.curve)).filter((a) => !known.includes(a));
    if (fresh.length) logs = logs.concat(await call("getLogs new curves", () => client.getLogs({ address: fresh, events: CURVE_EVENTS, fromBlock: from, toBlock: to })));
    const trades = logs.filter((e) => e.eventName === "Trade");
    const fulls = logs.filter((e) => e.eventName === "CurveFull");
    const grads = logs.filter((e) => e.eventName === "Graduated");
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
      for (const e of created) {
        const a = e.args;
        await db.query(
          `insert into coins (chain_id, address, curve, creator, name, symbol, metadata_uri, lock_seconds, fee_mode, created_block, created_tx, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (chain_id, address) do nothing`,
          [c.chainId, lc(a.coin), lc(a.curve), lc(a.creator), a.name, a.symbol, a.metadataURI, Number(a.lockSeconds), Number(a.feeMode), String(e.blockNumber), e.transactionHash, await ts(e.blockNumber)],
        );
        // starting price from the curve's fixed starting reserves (not the end-of-block state,
        // which already includes a launch buy made in the same transaction)
        const abi = [{ type: "function", name: "startVUsdc", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
                     { type: "function", name: "startVCoin", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }];
        const [vu, vc] = await Promise.all([
          client.readContract({ address: a.curve, abi, functionName: "startVUsdc" }),
          client.readContract({ address: a.curve, abi, functionName: "startVCoin" }),
        ]);
        const price = usd(vu) / tok(vc);
        await db.query("update coins set v_usdc=$3, v_coin=$4, price_usd=$5, mc_usd=$6, start_mc_usd=$6 where chain_id=$1 and address=$2 and trades_count=0",
          [c.chainId, lc(a.coin), usd(vu), tok(vc), price, price * SUPPLY]);
      }
      const curves = new Map();
      for (const r of (await db.query("select curve, address, creator from coins where chain_id=$1", [c.chainId])).rows) curves.set(r.curve, r);
      const ordered = [...trades.map((e) => ["t", e]), ...fulls.map((e) => ["f", e]), ...grads.map((e) => ["g", e])]
        .sort((x, y) => (x[1].blockNumber === y[1].blockNumber ? x[1].logIndex - y[1].logIndex : x[1].blockNumber < y[1].blockNumber ? -1 : 1));
      for (const [kind, e] of ordered) {
        const info = curves.get(lc(e.address));
        if (!info) continue; // not one of our curves
        const coin = info.address;
        const at = await ts(e.blockNumber);
        if (kind === "t") {
          const a = e.args;
          const price = usd(a.vUsdcAfter) / tok(a.vCoinAfter);
          // The creator's launch buy is sent by the hub; credit it to the creator.
          // Buyback-and-burn buys are sent from the burn address.
          let trader = lc(a.trader);
          if (trader === lc(c.hub)) trader = info.creator;
          else if (c.router && trader === lc(c.router)) trader = viaRouter.get(`${e.transactionHash}:${lc(e.address)}`) ?? trader;
          const r = await db.query(
            `insert into trades (chain_id, tx_hash, log_index, coin, trader, is_buy, usdc, coins, fee, price_usd, mc_usd, block, ts)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing`,
            [c.chainId, e.transactionHash, e.logIndex, coin, trader, a.isBuy, usd(a.usdcAmount), tok(a.coinAmount), usd(a.fee), price, price * SUPPLY, String(e.blockNumber), at],
          );
          if (r.rowCount) {
            await db.query(
              `update coins set v_usdc=$3, v_coin=$4, price_usd=$5, mc_usd=$6, trades_count=trades_count+1, volume_usd=volume_usd+$7, last_trade_at=$8,
                 usdc_reserve = greatest(0, usdc_reserve + case when $9 then $7 - $10 else -($7 + $10) end)
               where chain_id=$1 and address=$2`,
              [c.chainId, coin, usd(a.vUsdcAfter), tok(a.vCoinAfter), price, price * SUPPLY, usd(a.usdcAmount), at, a.isBuy, usd(a.fee)],
            );
          }
        } else if (kind === "f") {
          // A full curve graduates right away: the relayer sends graduate() (gas paid by ArkhamPad).
          await db.query("update coins set phase = greatest(phase, 1) where chain_id=$1 and address=$2", [c.chainId, coin]);
          if (relayer) relayer.graduate(c.chainId, e.address).catch((err) => console.log(new Date().toISOString(), `${c.name}: graduate ${e.address} failed: ${err.message}`));
        } else {
          const a = e.args;
          await db.query("update coins set phase=2, usdc_reserve=0, graduated_at=$3, pool_usdc=$4, pool_coins=$5 where chain_id=$1 and address=$2",
            [c.chainId, coin, at, usd(a.usdcToPool), tok(a.coinsToPool)]);
        }
      }
      for (const e of promos) {
        const a = e.args;
        const at = await ts(e.blockNumber);
        await db.query(
          `insert into promotions (chain_id, tx_hash, log_index, coin, coin_chain_id, payer, plan, seconds, price_usd, starts_at, ends_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing`,
          [c.chainId, e.transactionHash, e.logIndex, lc(a.coin), String(a.chainId), promoPayer.get(e.transactionHash) ?? lc(a.payer), Number(a.plan), Number(a.seconds_), usd(a.price), at, new Date(at.getTime() + Number(a.seconds_) * 1000)],
        );
      }
      // Trades in the locked Uniswap pools of graduated coins (from any app, not only ours).
      let poolTrades = 0;
      if (c.poolManager && c.guard && c.usdc) {
        const grad = (await db.query("select address, creator from coins where chain_id=$1 and phase=2", [c.chainId])).rows;
        if (grad.length) {
          const byId = new Map(grad.map((r) => [poolIdOf(c.usdc, r.address, c.guard), r]));
          const ids = [...byId.keys()];
          const viaPool = new Map();
          for (const e of routerLogs) if (e.eventName === "PoolTraded") viaPool.set(`${e.transactionHash}:${lc(e.args.coin)}`, lc(e.args.user));
          for (let i = 0; i < ids.length; i += 100) {
            const swaps = await call("getLogs pools", () => client.getLogs({ address: c.poolManager, event: EV.swap, args: { id: ids.slice(i, i + 100) }, fromBlock: from, toBlock: to }));
            for (const e of swaps) {
              const r = byId.get(e.args.id);
              if (!r) continue;
              const usdcIs0 = BigInt(c.usdc) < BigInt(r.address);
              const t = poolTrade(e.args, usdcIs0);
              let trader = lc(e.args.sender);
              if (c.router && trader === lc(c.router)) trader = viaPool.get(`${e.transactionHash}:${r.address}`) ?? trader;
              const at = await ts(e.blockNumber);
              const ins = await db.query(
                `insert into trades (chain_id, tx_hash, log_index, coin, trader, is_buy, usdc, coins, fee, price_usd, mc_usd, block, ts)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing`,
                [c.chainId, e.transactionHash, e.logIndex, r.address, trader, t.isBuy, t.usdc, t.coins, t.fee, t.price, t.price * SUPPLY, String(e.blockNumber), at],
              );
              if (ins.rowCount) {
                poolTrades++;
                await db.query("update coins set price_usd=$3, mc_usd=$4, trades_count=trades_count+1, volume_usd=volume_usd+$5, last_trade_at=$6 where chain_id=$1 and address=$2",
                  [c.chainId, r.address, t.price, t.price * SUPPLY, t.usdc, at]);
              }
            }
          }
        }
      }
      await db.query("update sync_state set last_block=$2, updated_at=now() where chain_id=$1", [c.chainId, String(to)]);
      await db.query("commit");
      if (created.length || trades.length || grads.length || promos.length || poolTrades)
        log(`${c.name}: blocks ${from}-${to} coins+${created.length} trades+${trades.length} pool+${poolTrades} grads+${grads.length} promos+${promos.length}`);
    } catch (err) {
      await db.query("rollback");
      throw err;
    } finally {
      db.release();
    }
    from = to + 1n;
    if (c.rangeDelayMs) await sleep(c.rangeDelayMs); // stay under the RPC's requests-per-second limit
  }
}

const status = {};
async function loop(c) {
  const rpc = (process.env[c.rpcEnv] || "").trim();
  if (!rpc) { log(`${c.name}: ${c.rpcEnv} not set, skipped`); return; }
  const client = createPublicClient({ transport: viemHttp(rpc, { retryCount: 3, timeout: 20_000 }) });
  c.hub = getAddress(c.hub);
  if (c.promote) c.promote = getAddress(c.promote);
  if (c.router) c.router = getAddress(c.router);
  if (c.poolManager) c.poolManager = getAddress(c.poolManager);
  log(`${c.name}: indexing from block ${c.startBlock}`);
  for (;;) {
    try {
      await syncChain(c, client);
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
if (!process.env.ONCE) startMarkets(pool);
// Curves that filled while we were down: graduate them now (and re-check every few minutes).
if (relayer) {
  const sweep = async () => {
    try {
      const { rows } = await pool.query("select chain_id, curve from coins where phase = 1");
      for (const r of rows) await relayer.graduate(r.chain_id, r.curve).catch((e) => console.log(new Date().toISOString(), `graduate ${r.curve} failed: ${e.message}`));
    } catch (e) { console.log(new Date().toISOString(), `graduate sweep error: ${e.message}`); }
  };
  setTimeout(sweep, 5_000);
  setInterval(sweep, 300_000);
}
await Promise.all(CHAINS.map(loop));
if (process.env.ONCE) await pool.end();
