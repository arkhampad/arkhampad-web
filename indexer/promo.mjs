// ElyScreener paid promotions: checks every pending order's payment on-chain and switches it on.
// A pending order only becomes "paid" when its transaction really sent the plan's price (USDC or HYPE)
// to the promo wallet. Env: ES_PAY_TO (the wallet that receives payments, required),
// ELYSIUM_RPC (comma list), ES_USDC (optional; otherwise found from the USDC-paired pools).
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const HOURS = { boost12: 12, boost24: 24, boost72: 72, banner1: 24, banner7: 168, profile: null };

export function startPromo(pool, { log = console.log } = {}) {
  const payTo = (process.env.ES_PAY_TO || "").trim().toLowerCase();
  const rpcs = (process.env.ELYSIUM_RPC || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!/^0x[0-9a-f]{40}$/.test(payTo) || !rpcs.length) { log("promo: off (set ES_PAY_TO)"); return; }
  let usdc = (process.env.ES_USDC || "").trim().toLowerCase(), usdcDec = 6;
  async function rpc(method, params) {
    let last;
    for (const u of rpcs) {
      try { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12000) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; } catch (e) { last = e; }
    }
    throw last;
  }
  async function findUsdc() {
    if (usdc) return usdc;
    const r = await pool.query(`select lower(whype) w, count(*) n from ely_tokens where venue = 'cl' and whype is not null group by 1 order by 2 desc limit 1`).catch(() => ({ rows: [] }));
    usdc = r.rows[0]?.w || "";
    if (usdc) { const d = await rpc("eth_call", [{ to: usdc, data: "0x313ce567" }, "latest"]).catch(() => null); if (d) usdcDec = Number(BigInt(d)); log(`promo: USDC ${usdc} (${usdcDec} decimals)`); }
    return usdc;
  }
  async function hypeUsd() {
    const r = await pool.query(`select v from ely_meta where k = 'hype_usd' limit 1`).catch(() => ({ rows: [] }));
    const v = r.rows[0]?.v; return typeof v === "number" ? v : Number(v?.usd ?? v?.price ?? v) || 0;
  }
  async function check(o) {
    const [tx, rc] = await Promise.all([rpc("eth_getTransactionByHash", [o.tx]), rpc("eth_getTransactionReceipt", [o.tx])]);
    if (!tx || !rc) return { wait: true };
    if (rc.status !== "0x1") return { bad: "transaction failed" };
    if (String(tx.from).toLowerCase() !== o.payer) return { bad: "paid from a different wallet" };
    const blk = await rpc("eth_getBlockByNumber", [rc.blockNumber, false]).catch(() => null);
    if (blk && Date.now() / 1000 - Number(BigInt(blk.timestamp)) > 3 * 86400) return { bad: "payment is older than 3 days" };
    const usd = Number(o.usd);
    if (o.pay_asset === "HYPE") {
      if (String(tx.to).toLowerCase() !== payTo) return { bad: "not sent to the promo wallet" };
      const px = await hypeUsd(); if (!px) return { wait: true };
      const paid = Number(BigInt(tx.value)) / 1e18 * px;
      return paid >= usd * 0.95 ? { ok: true } : { bad: `paid $${paid.toFixed(2)}, needs $${usd}` };
    }
    const u = await findUsdc(); if (!u) return { wait: true };
    const pad = (a) => "0x" + a.slice(2).padStart(64, "0");
    let amt = 0n;
    for (const l of rc.logs || []) if (String(l.address).toLowerCase() === u && l.topics?.[0] === TRANSFER && l.topics[2]?.toLowerCase() === pad(payTo)) amt += BigInt(l.data);
    const paid = Number(amt) / 10 ** usdcDec;
    return paid >= usd * 0.995 ? { ok: true } : { bad: paid ? `paid $${paid.toFixed(2)}, needs $${usd}` : "no USDC sent to the promo wallet" };
  }
  async function tick() {
    const { rows } = await pool.query(`select * from es_orders where status = 'pending' order by id limit 30`);
    for (const o of rows) {
      try {
        const r = await check(o);
        if (r.ok) {
          const h = HOURS[o.plan];
          // a new boost/banner for the same coin starts where the running one ends
          const q = await pool.query(`select max(ends_at) e from es_orders where status = 'paid' and kind = $1 and coalesce(token,'') = coalesce($2,'') and ends_at > now()`, [o.kind, o.token]);
          const start = o.kind === "banner" ? new Date() : q.rows[0]?.e && new Date(q.rows[0].e) > new Date() ? new Date(q.rows[0].e) : new Date();
          const end = h ? new Date(start.getTime() + h * 3600e3) : null;
          await pool.query(`update es_orders set status = 'paid', paid_at = now(), starts_at = $2, ends_at = $3, note = null where id = $1`, [o.id, start, end]);
          log(`promo: #${o.id} ${o.plan} ${o.token || ""} paid ($${o.usd} ${o.pay_asset})`);
        } else if (r.bad) {
          await pool.query(`update es_orders set status = 'rejected', note = $2 where id = $1`, [o.id, r.bad]);
          log(`promo: #${o.id} rejected: ${r.bad}`);
        } else if (Date.now() - new Date(o.created_at).getTime() > 6 * 3600e3) {
          await pool.query(`update es_orders set status = 'rejected', note = 'payment not found on-chain' where id = $1`, [o.id]);
        }
      } catch (e) { log(`promo: #${o.id} check failed: ${e.message}`); }
    }
  }
  log(`promo: on, payments to ${payTo}`);
  const run = () => tick().catch((e) => log(`promo: ${e.message}`));
  run(); setInterval(run, 20_000);
}
