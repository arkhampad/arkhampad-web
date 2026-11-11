// ElyScreener Auto Trade keeper. Watches the rules users made in the ElyAutoVault and fires them when the live
// price says so; for whale-copy rules it buys what the whale just bought and closes copied positions at their
// take-profit / stop-loss. The wallet only pays gas and can only make the vault trade through the router: it has
// no way to withdraw or send anyone's funds (the vault has no such function). Runs when ES_AUTO_VAULT and
// ES_AUTO_KEY (a wallet with a little HYPE for gas) are set on Railway. ES_AUTO_DRY=1 only logs what it would do.
import { createPublicClient, createWalletClient, defineChain, fallback, getAddress, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const POOL = "(uint8 venue,address target,address token,address hype,bool tokenIs0,uint24 fee,int24 tickSpacing,address hooks)";
const VAULT_ABI = parseAbi([
  "function nextId() view returns (uint256)",
  `function ruleOf(uint256) view returns ((address owner,uint8 kind,bool active,uint16 slipBps,uint40 expiry,${POOL} pool,uint256 amount,uint256 trigger,uint256 floor,address whale,uint256 budget,uint256 maxPerTrade,uint16 tpBps,uint16 slBps))`,
  `function positionsOf(uint256) view returns ((bool open,address token,uint256 amt,uint256 cost,${POOL} pool)[])`,
  "function execute(uint256)",
  `function copyBuy(uint256 id,${POOL} pool,uint256 hypeAmount) returns (uint256)`,
  "function closePosition(uint256 id,uint256 index)",
]);
const ROUTER_ABI = parseAbi([`function quote(${POOL} p,bool isBuy,uint256 amountIn) returns (uint256)`]);
const ZERO = "0x0000000000000000000000000000000000000000";
const WHYPE = "0x43ca3cee078d8cb8528915b16e8bdcc9adbe6090";
const DENY_HOOKS = new Set(["0x423086612f5ffa9d9532241caffcf03124dfc144"]); // KPURR: keeps a seller's payout
const WL_SELECTOR = "c683630d"; // isWhitelist(address): a hook that asks this can block sellers
const EVERY_MS = 4000;
const hookMemo = new Map();

const bps = 10_000n;
const quoteOk = (w) => { w = String(w || "").toLowerCase(); return !w || w === ZERO || w === WHYPE; };

/** The Pool struct the router wants, from an ely_tokens row (same rules as the site's poolArg). */
export function poolFromRow(t) {
  if (!t || t.venue === "cl" || !quoteOk(t.whype)) return null;
  const v4 = t.venue === "v4";
  const target = v4 ? t.manager : t.pool;
  if (!target || !/^0x[0-9a-f]{40}$/i.test(target)) return null;
  return { venue: v4 ? 4 : 3, target: getAddress(target), token: getAddress(t.address), hype: getAddress(t.whype || ZERO), tokenIs0: !!t.token_is0, fee: Number(t.fee ?? 0), tickSpacing: Number(t.tick_spacing ?? 0), hooks: getAddress(t.hooks || ZERO) };
}

export async function autoLoop({ rpc, vault, router, key, pool, log }) {
  const urls = [...new Set(["https://rpc-live.elysp.com", ...String(rpc || "").split(",").map((u) => u.trim()).filter(Boolean), "https://arkhampad.com/api/ely-rpc"])];
  const transport = () => fallback(urls.map((u) => http(u, { timeout: 10_000, retryCount: 1 })));
  const chain = defineChain({ id: 99901, name: "Elysium", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: urls } } });
  const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
  const pub = createPublicClient({ chain, transport: transport() });
  const wallet = createWalletClient({ chain, account, transport: transport() });
  const dry = process.env.ES_AUTO_DRY === "1";
  const V = getAddress(vault);
  const R = getAddress(router);
  log(`auto trade: keeper ${account.address} on vault ${V}${dry ? " (DRY RUN)" : ""}`);

  const quote = async (p, isBuy, amount) => {
    try { return (await pub.simulateContract({ address: R, abi: ROUTER_ABI, functionName: "quote", args: [p, isBuy, amount], account: account.address })).result; }
    catch (e) { const k = `q${p.target}${p.token}`; if (Date.now() - (lastLog.get(k) || 0) > 120_000) { lastLog.set(k, Date.now()); log(`auto trade: quote failed for ${p.token} (${String(e.shortMessage || e.message).split("\n")[0].slice(0, 140)})`); } return null; }
  };
  const lastLog = new Map(); // rule id / key -> last time a status line was written (keeps the log short)
  // a coin whose hook can keep a seller's payout is never bought for anyone
  const hookBad = async (h) => {
    const a = String(h || ZERO).toLowerCase();
    if (a === ZERO) return false;
    if (DENY_HOOKS.has(a)) return true;
    if (!hookMemo.has(a)) hookMemo.set(a, pub.getCode({ address: a }).then((c) => !!c && c.toLowerCase().includes(WL_SELECTOR)).catch(() => true)); // can't check -> treat as bad
    return hookMemo.get(a);
  };
  const send = async (label, req) => {
    if (dry) { log(`auto trade [dry]: would ${label}`); return false; }
    try {
      const { request } = await pub.simulateContract({ address: V, abi: VAULT_ABI, account, ...req });
      const gas = await pub.estimateContractGas({ address: V, abi: VAULT_ABI, account, ...req }).then((g) => (g * 13n) / 10n).catch(() => 1_500_000n);
      const hash = await wallet.writeContract({ ...request, gas });
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 800 });
      log(`auto trade: ${label} -> ${rc.status} ${hash}`);
      return rc.status === "success";
    } catch (e) {
      log(`auto trade: ${label} skipped (${String(e.shortMessage || e.message).split("\n")[0].slice(0, 120)})`);
      return false;
    }
  };

  const rules = new Map(); // id -> last read rule
  const cursor = new Map(); // COPY rule id -> time of the last whale trade we looked at
  let known = 1n;
  for (;;) {
    const t0 = Date.now();
    try {
      const n = await pub.readContract({ address: V, abi: VAULT_ABI, functionName: "nextId" });
      for (; known < n; known++) {
        const r = await pub.readContract({ address: V, abi: VAULT_ABI, functionName: "ruleOf", args: [known] });
        if (r.active) rules.set(known, r);
      }
      for (const [id, old] of [...rules]) {
        const r = await pub.readContract({ address: V, abi: VAULT_ABI, functionName: "ruleOf", args: [id] });
        if (!r.active || (r.expiry && Date.now() / 1000 > Number(r.expiry) + 60)) { rules.delete(id); continue; }
        rules.set(id, r);
        try {
          if (r.kind <= 2) await price(id, r);
          else await copy(id, r);
        } catch (e) { log(`auto trade: rule ${id} ${String(e.shortMessage || e.message).slice(0, 120)}`); }
      }
    } catch (e) {
      log(`auto trade: ${String(e.shortMessage || e.message).slice(0, 140)}`);
    }
    await new Promise((res) => setTimeout(res, Math.max(500, EVERY_MS - (Date.now() - t0))));
  }

  /** limit buy (0), take-profit (1), stop-loss (2): same checks the vault makes, so we only spend gas when it will pass */
  async function price(id, r) {
    const q = await quote(r.pool, r.kind === 0, r.amount);
    if (q == null) return;
    if (Date.now() - (lastLog.get(id) || 0) > 120_000) { lastLog.set(id, Date.now()); log(`auto trade: rule ${id} (${["limit buy", "take-profit", "stop-loss"][r.kind]}) quote ${q} vs trigger ${r.trigger}${r.kind === 2 ? ` (floor ${r.floor})` : ""}`); }
    const go = r.kind === 0 ? q >= r.trigger : r.kind === 1 ? q >= r.trigger : q <= r.trigger && q >= r.floor;
    if (!go) return;
    if (await send(`rule ${id} (${["limit buy", "take-profit", "stop-loss"][r.kind]})`, { functionName: "execute", args: [id] })) rules.delete(id);
  }

  /** whale copy: buy what the whale bought, close copied positions at take-profit / stop-loss */
  async function copy(id, r) {
    // exits first
    if (r.tpBps || r.slBps) {
      const pos = await pub.readContract({ address: V, abi: VAULT_ABI, functionName: "positionsOf", args: [id] });
      for (let i = 0; i < pos.length; i++) {
        const p = pos[i];
        if (!p.open) continue;
        const q = await quote(p.pool, false, p.amt);
        if (q == null) continue;
        const tp = r.tpBps > 0 && q >= (p.cost * (bps + BigInt(r.tpBps))) / bps;
        const sl = r.slBps > 0 && q <= (p.cost * (bps - BigInt(r.slBps))) / bps;
        if (tp || sl) await send(`close position ${id}/${i} (${tp ? "take-profit" : "stop-loss"})`, { functionName: "closePosition", args: [id, BigInt(i)] });
      }
    }
    if (r.budget === 0n) return;
    const whale = String(r.whale).toLowerCase();
    // a rule seen for the first time only follows trades from now on (never replays the whale's past)
    const since = cursor.get(id) ?? new Date();
    if (!cursor.has(id)) { cursor.set(id, since); return; }
    const { rows } = await pool.query(
      `select t.at, t.token, k.* from ely_trades t join ely_tokens k on k.address = t.token
        where t.trader = $1 and t.side = 'buy' and t.at > $2 order by t.at asc limit 20`,
      [whale, since]
    );
    if (!rows.length) return;
    cursor.set(id, rows[rows.length - 1].at);
    const mine = await pub.readContract({ address: V, abi: VAULT_ABI, functionName: "positionsOf", args: [id] });
    const have = new Set(mine.map((p) => p.token.toLowerCase()));
    let budget = r.budget;
    for (const t of rows) {
      const token = String(t.token).toLowerCase();
      if (have.has(token)) continue; // one position per coin per rule
      const p = poolFromRow(t);
      if (!p) continue;
      if (await hookBad(p.hooks)) { log(`auto trade: rule ${id} skips ${t.symbol || token} (hook can block sellers)`); continue; }
      const amount = budget < r.maxPerTrade ? budget : r.maxPerTrade;
      if (amount === 0n) break;
      if (await send(`rule ${id} copies ${t.symbol || token}`, { functionName: "copyBuy", args: [id, p, amount] })) { have.add(token); budget -= amount; }
    }
  }
}
