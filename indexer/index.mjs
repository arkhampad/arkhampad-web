// ArkhamPad indexer: reads coin launches, curve trades, graduations and
// promotions from every configured chain and writes them to Postgres (Supabase).
// Env: DATABASE_URL, one RPC URL per chain (see chains.json -> rpcEnv),
//      optional CHAINS_FILE, POLL_SECONDS (default 4), BLOCK_RANGE (overrides chains.json blockRange).
import fs from "node:fs";
import http from "node:http";
import pg from "pg";
import { createPublicClient, http as viemHttp, parseAbiItem, getAddress } from "viem";

const POLL = Number(process.env.POLL_SECONDS || 4) * 1000;
const RANGE_DEFAULT = process.env.BLOCK_RANGE ? BigInt(process.env.BLOCK_RANGE) : null;
const CHAINS = JSON.parse(fs.readFileSync(process.env.CHAINS_FILE || new URL("./chains.json", import.meta.url), "utf8"));
const SUPPLY = 1_000_000_000; // every coin has a fixed 1B supply

const EV = {
  created: parseAbiItem("event CoinCreated(address indexed coin, address indexed curve, address indexed creator, string name, string symbol, string metadataURI, uint256 lockSeconds, uint8 feeMode)"),
  trade: parseAbiItem("event Trade(address indexed trader, bool indexed isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 fee, uint256 vUsdcAfter, uint256 vCoinAfter)"),
  full: parseAbiItem("event CurveFull(uint256 usdcReserve)"),
  graduated: parseAbiItem("event Graduated(uint256 usdcToPool, uint256 coinsToPool, uint256 coinsBurned, uint256 graduationFee)"),
  promoted: parseAbiItem("event Promoted(address indexed coin, uint256 indexed chainId, address indexed payer, uint8 plan, uint256 seconds_, uint256 price)"),
};

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
  const head = await client.getBlockNumber();
  let from = (await lastBlock(c.chainId, c.startBlock)) + 1n;
  while (from <= head) {
    const to = from + RANGE - 1n > head ? head : from + RANGE - 1n;
    const [created, trades, fulls, grads, promos] = await Promise.all([
      client.getLogs({ address: c.hub, event: EV.created, fromBlock: from, toBlock: to }),
      client.getLogs({ event: EV.trade, fromBlock: from, toBlock: to }),
      client.getLogs({ event: EV.full, fromBlock: from, toBlock: to }),
      client.getLogs({ event: EV.graduated, fromBlock: from, toBlock: to }),
      c.promote ? client.getLogs({ address: c.promote, event: EV.promoted, fromBlock: from, toBlock: to }) : [],
    ]);
    const blocks = new Map();
    const ts = async (bn) => {
      if (!blocks.has(bn)) blocks.set(bn, new Date(Number((await client.getBlock({ blockNumber: bn })).timestamp) * 1000));
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
          await db.query("update coins set phase = greatest(phase, 1) where chain_id=$1 and address=$2", [c.chainId, coin]);
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
          [c.chainId, e.transactionHash, e.logIndex, lc(a.coin), String(a.chainId), lc(a.payer), Number(a.plan), Number(a.seconds_), usd(a.price), at, new Date(at.getTime() + Number(a.seconds_) * 1000)],
        );
      }
      await db.query("update sync_state set last_block=$2, updated_at=now() where chain_id=$1", [c.chainId, String(to)]);
      await db.query("commit");
      if (created.length || trades.length || grads.length || promos.length)
        log(`${c.name}: blocks ${from}-${to} coins+${created.length} trades+${trades.length} grads+${grads.length} promos+${promos.length}`);
    } catch (err) {
      await db.query("rollback");
      throw err;
    } finally {
      db.release();
    }
    from = to + 1n;
  }
}

const status = {};
async function loop(c) {
  const rpc = process.env[c.rpcEnv];
  if (!rpc) { log(`${c.name}: ${c.rpcEnv} not set, skipped`); return; }
  const client = createPublicClient({ transport: viemHttp(rpc, { retryCount: 3, timeout: 20_000 }) });
  c.hub = getAddress(c.hub);
  if (c.promote) c.promote = getAddress(c.promote);
  log(`${c.name}: indexing from block ${c.startBlock}`);
  for (;;) {
    try {
      await syncChain(c, client);
      status[c.name] = { ok: true, at: new Date().toISOString() };
    } catch (err) {
      status[c.name] = { ok: false, at: new Date().toISOString(), error: String(err.shortMessage || err.message) };
      log(`${c.name}: error`, err.shortMessage || err.message);
    }
    if (process.env.ONCE) return;
    await new Promise((r) => setTimeout(r, POLL));
  }
}

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
if (process.env.PORT) http.createServer((_, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(status)); }).listen(process.env.PORT);
await Promise.all(CHAINS.map(loop));
if (process.env.ONCE) await pool.end();
