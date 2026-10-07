// Proof that ArkhamPad coins show up on DEX screeners: for every coin launched on a
// mainnet chain, ask DexScreener's public API when it first lists the coin and save that
// time (coins.dex_listed_at). The coin page shows "Live on DexScreener ✓ (42 s after
// launch)". A coin that isn't listed 10 minutes after launch raises an alert for the owner.
const SLUG = { 8453: "base", 4663: "robinhood", 56: "bsc" };
const API = "https://api.dexscreener.com/latest/dex/tokens/";

export function startDexWatch(pool, { log, notifier }) {
  const warned = new Set();
  async function round() {
    const { rows } = await pool.query(
      `select chain_id, address, symbol, created_at from coins
       where dex_listed_at is null and chain_id = any($1::int[]) and created_at > now() - interval '24 hours'
       order by created_at desc limit 60`,
      [Object.keys(SLUG).map(Number)],
    );
    if (!rows.length) return;
    // DexScreener takes up to 30 addresses per call
    for (let i = 0; i < rows.length; i += 30) {
      const batch = rows.slice(i, i + 30);
      let pairs = [];
      try {
        const r = await fetch(API + batch.map((x) => x.address).join(","), { signal: AbortSignal.timeout(10_000) });
        if (r.ok) pairs = (await r.json()).pairs ?? [];
      } catch { continue; }
      const now = new Date();
      for (const c of batch) {
        const hit = pairs.find((p) => p.chainId === SLUG[c.chain_id] && String(p.baseToken?.address || "").toLowerCase() === c.address);
        if (hit) {
          await pool.query("update coins set dex_listed_at = $3 where chain_id=$1 and address=$2 and dex_listed_at is null", [c.chain_id, c.address, now]);
          const secs = Math.round((now - new Date(c.created_at)) / 1000);
          log(`dexwatch: $${c.symbol} listed on DexScreener ${secs}s after launch`);
        } else if (now - new Date(c.created_at) > 10 * 60_000 && !warned.has(c.address)) {
          warned.add(c.address);
          log(`dexwatch: $${c.symbol} (${c.chain_id}) NOT on DexScreener 10 min after launch`);
          const to = (process.env.ALERT_WALLET || "").trim().toLowerCase();
          if (to && notifier) notifier.notify(to, { kind: "system", title: `⚠️ $${c.symbol} not on DexScreener yet`, body: `Launched 10+ minutes ago on chain ${c.chain_id} and DexScreener doesn't list it. Check the pool.`, url: `/coin/?c=${c.chain_id}-${c.address}` });
        }
      }
    }
  }
  const tick = () => round().catch((e) => { if (!/does not exist/.test(String(e.message))) log(`dexwatch: ${e.message}`); });
  setTimeout(tick, 15_000);
  setInterval(tick, 20_000);
}
