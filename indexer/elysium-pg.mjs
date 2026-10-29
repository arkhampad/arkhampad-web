// Postgres store for the Elysium indexer (./elysium.mjs): tables from db/025_elysium.sql.
// Tokens are also kept in memory (the indexer looks pools up on every swap).

const COLS = ["address", "name", "symbol", "decimals", "supply", "uri", "image", "description", "venue", "pool", "manager", "whype", "token_is0", "fee", "tick_spacing", "hooks", "maker", "creator", "launchpad", "ours", "created_block", "created_at", "price_hype"];

export async function makePgStore(pool) {
  const tokens = new Map();
  const { rows } = await pool.query(`select ${COLS.join(",")} from ely_tokens`);
  for (const r of rows) tokens.set(r.address, { ...r, supply: String(r.supply), decimals: Number(r.decimals) });

  return {
    tokens: () => tokens,
    getState: async (k) => (await pool.query("select v from ely_state where k=$1", [k])).rows[0]?.v,
    setState: async (k, v) => void (await pool.query("insert into ely_state (k, v) values ($1, $2) on conflict (k) do update set v = excluded.v", [k, String(v)])),
    setMeta: async (k, v) => void (await pool.query("insert into ely_meta (k, v, updated_at) values ($1, $2, now()) on conflict (k) do update set v = excluded.v, updated_at = now()", [k, JSON.stringify(v)])),
    upsertToken: async (t) => {
      tokens.set(t.address, { ...tokens.get(t.address), ...t });
      const vals = COLS.map((c) => t[c] ?? null);
      await pool.query(
        `insert into ely_tokens (${COLS.join(",")}) values (${COLS.map((_, i) => `$${i + 1}`).join(",")})
         on conflict (address) do update set ${COLS.filter((c) => c !== "address").map((c) => `${c} = coalesce(excluded.${c}, ely_tokens.${c})`).join(", ")}, updated_at = now()`,
        vals
      );
    },
    addTrades: async (list) => {
      for (let i = 0; i < list.length; i += 500) {
        const part = list.slice(i, i + 500);
        const cols = ["token", "tx", "log_index", "block", "at", "side", "hype", "amount", "price_hype", "trader"];
        const vals = [];
        const rowsSql = part.map((x, j) => {
          cols.forEach((c) => vals.push(x[c] ?? null));
          return `(${cols.map((_, k) => `$${j * cols.length + k + 1}`).join(",")})`;
        });
        await pool.query(`insert into ely_trades (${cols.join(",")}) values ${rowsSql.join(",")} on conflict (tx, log_index) do nothing`, vals);
      }
    },
    applyTransfers: async (list) => {
      // net change per (token, holder) in this batch, then one upsert each
      const net = new Map();
      const ZERO = "0x0000000000000000000000000000000000000000";
      for (const x of list) {
        const v = BigInt(x.value);
        if (x.from !== ZERO) net.set(`${x.token}|${x.from}`, (net.get(`${x.token}|${x.from}`) ?? 0n) - v);
        if (x.to !== ZERO) net.set(`${x.token}|${x.to}`, (net.get(`${x.token}|${x.to}`) ?? 0n) + v);
      }
      const entries = [...net.entries()].filter(([, v]) => v !== 0n);
      for (let i = 0; i < entries.length; i += 500) {
        const part = entries.slice(i, i + 500);
        const vals = [];
        const rowsSql = part.map(([k, v], j) => {
          const [token, holder] = k.split("|");
          vals.push(token, holder, v.toString());
          return `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3}::numeric)`;
        });
        await pool.query(`insert into ely_balances (token, holder, amount) values ${rowsSql.join(",")} on conflict (token, holder) do update set amount = ely_balances.amount + excluded.amount`, vals);
      }
    },
    refreshStats: async () => {
      const r = await pool.query("select v from ely_meta where k='hype_usd'");
      const usd = Number(r.rows[0]?.v) || 0;
      await pool.query("select ely_refresh_stats($1)", [usd]);
    },
  };
}
