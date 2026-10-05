// Volume limits for the first weeks on mainnet: a cap per trade, per person per day and for the
// whole platform per day. Set with Railway variables; 0 turns one off. Testnets are not limited
// unless LIMITS_ON=all.
const num = (v, d) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : d; };
export const LIMITS = {
  trade: num(process.env.LIMIT_TRADE_USD, 500),
  userDay: num(process.env.LIMIT_USER_DAY_USD, 2000),
  day: num(process.env.LIMIT_DAY_USD, 50000),
  on: (process.env.LIMITS_ON || "mainnet").toLowerCase(), // mainnet | all | off
};
const TESTNETS = new Set([84532, 46630, 97, 11155111, 421614]);
const money = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
const fail = (msg, code) => { const e = new Error(msg); e.status = 429; e.code = code; return e; };

export function makeLimits({ log }) {
  const ledger = []; // { user, usd, at, chainId }: buys of other-DEX coins (they are not in the trades table)
  const applies = (chainId) => LIMITS.on === "all" || (LIMITS.on === "mainnet" && !TESTNETS.has(chainId));

  async function spent(db, chainIds, user) {
    const since = new Date(Date.now() - 86_400_000);
    const mem = ledger.filter((x) => x.at > since.getTime() && chainIds.includes(x.chainId) && (!user || x.user === user));
    let fromDb = 0;
    if (db) {
      const q = user
        ? await db.query("select coalesce(sum(usdc),0) s from trades where is_buy and ts > $1 and chain_id = any($2) and trader = $3", [since, chainIds, user])
        : await db.query("select coalesce(sum(usdc),0) s from trades where is_buy and ts > $1 and chain_id = any($2)", [since, chainIds]);
      fromDb = Number(q.rows[0].s) || 0;
    }
    // our curves and pools come from the database; other-DEX buys from the ledger
    return fromDb + mem.reduce((a, x) => a + x.usd, 0);
  }

  /** Throws a friendly error when a buy would go over a limit. */
  async function check(db, n, user, usd, liveChains) {
    if (!applies(n.c.chainId) || !(usd > 0)) return;
    const u = user.toLowerCase();
    if (LIMITS.trade && usd > LIMITS.trade) throw fail(`While ArkhamPad is starting out, one trade can be up to ${money(LIMITS.trade)}.`, "LIMIT_TRADE");
    const chains = liveChains.filter(applies);
    if (LIMITS.userDay) {
      const mine = await spent(db, chains, u);
      if (mine + usd > LIMITS.userDay) throw fail(`You've reached today's limit of ${money(LIMITS.userDay)} in buys while ArkhamPad is starting out. It frees up over the next 24 hours.`, "LIMIT_USER_DAY");
    }
    if (LIMITS.day) {
      const all = await spent(db, chains, null);
      if (all + usd > LIMITS.day) { log(`platform daily limit reached (${money(all)})`); throw fail("ArkhamPad has reached today's trading limit while we're starting out. Please try again later.", "LIMIT_DAY"); }
    }
  }

  function add(n, user, usd) { if (applies(n.c.chainId) && usd > 0) { ledger.push({ user: user.toLowerCase(), usd, at: Date.now(), chainId: n.c.chainId }); while (ledger.length && ledger[0].at < Date.now() - 86_400_000) ledger.shift(); } }

  return { check, add, applies };
}
