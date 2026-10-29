// In-memory store for the Elysium indexer (./elysium.mjs): used by the check script, and the shape
// the Postgres store (./elysium-pg.mjs) follows. Stats are computed the same way in both.

export function statsOf(t, trades, holders, hypeUsd, now = Date.now()) {
  const day = now - 86_400_000;
  const recent = trades.filter((x) => Date.parse(x.at) >= day);
  const last = trades.length ? trades[trades.length - 1] : null;
  const before = trades.filter((x) => Date.parse(x.at) < day).pop();
  const price = last?.price_hype ?? t.price_hype ?? 0;
  const supply = Number(BigInt(t.supply || "0")) / 10 ** (t.decimals ?? 18);
  const ref = before?.price_hype ?? recent[0]?.price_hype ?? null;
  return {
    price_hype: price,
    mcap_hype: price * supply,
    mcap_usd: hypeUsd ? price * supply * hypeUsd : null,
    vol24_hype: recent.reduce((s, x) => s + x.hype, 0),
    buys24: recent.filter((x) => x.side === "buy").length,
    sells24: recent.filter((x) => x.side === "sell").length,
    change24: ref ? ((price - ref) / ref) * 100 : null,
    holders,
    last_trade_at: last?.at ?? null,
  };
}

export function makeMemStore() {
  const state = new Map();
  const meta = new Map();
  const tokens = new Map();
  const trades = new Map(); // token -> list (in order)
  const balances = new Map(); // token -> Map(holder -> bigint)
  const ZERO = "0x0000000000000000000000000000000000000000";
  return {
    getState: async (k) => state.get(k),
    setState: async (k, v) => void state.set(k, v),
    setMeta: async (k, v) => void meta.set(k, v),
    meta,
    tokens: () => tokens,
    upsertToken: async (t) => void tokens.set(t.address, { ...tokens.get(t.address), ...t }),
    addTrades: async (list) => {
      for (const x of list) {
        if (!trades.has(x.token)) trades.set(x.token, []);
        trades.get(x.token).push(x);
      }
    },
    applyTransfers: async (list) => {
      for (const x of list) {
        if (!balances.has(x.token)) balances.set(x.token, new Map());
        const b = balances.get(x.token);
        const v = BigInt(x.value);
        if (x.from !== ZERO) b.set(x.from, (b.get(x.from) ?? 0n) - v);
        if (x.to !== ZERO) b.set(x.to, (b.get(x.to) ?? 0n) + v);
      }
    },
    refreshStats: async () => {
      const usd = meta.get("hype_usd");
      for (const t of tokens.values()) {
        const b = balances.get(t.address);
        const holders = b ? [...b.values()].filter((v) => v > 0n).length : 0;
        Object.assign(t, statsOf(t, trades.get(t.address) ?? [], holders, usd));
      }
    },
    trades,
    balances,
  };
}
