// Coin links (website / X / Telegram): read each coin's metadata once, in the background, and keep the result in ely_meta
// as 'links:<address>'. ElyScreener's coin page then shows them instantly instead of waiting on slow IPFS gateways.
// Busy coins first. Coins whose metadata could not be read are retried every 15 minutes.

const GATES = ["https://ipfs.io/ipfs/", "https://dweb.link/ipfs/", "https://gateway.pinata.cloud/ipfs/", "https://w3s.link/ipfs/", "https://cloudflare-ipfs.com/ipfs/"];

async function readMeta(uri) {
  if (uri.startsWith("data:")) { const r = await fetch(uri); return r.json(); }
  if (uri.startsWith("ipfs://") || /\/ipfs\//.test(uri)) {
    const path = uri.startsWith("ipfs://") ? uri.slice(7) : uri.split("/ipfs/")[1];
    return Promise.any(GATES.map((g) => fetch(g + path, { signal: AbortSignal.timeout(12000) }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })));
  }
  if (!/^https?:\/\//i.test(uri)) throw new Error("unsupported uri");
  const r = await fetch(uri, { signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error(String(r.status)); return r.json();
}

// same rules as the website: pulls website / X / Telegram out of whatever shape a launchpad stored them in
export function findLinks(j) {
  const out = { w: "", x: "", tg: "" }; const seen = new Set();
  const isImg = (v) => /ipfs|\.(png|jpe?g|gif|webp|svg|mp4)(\?|$)/i.test(v);
  const put = (v) => {
    if (typeof v !== "string") return; v = v.trim(); if (!v || v.length > 300) return;
    if (/t\.me\/|telegram/i.test(v) && !out.tg) out.tg = v;
    else if (/(^|\/\/|www\.)(x|twitter)\.com\//i.test(v) && !out.x) out.x = v;
    else if (/^https?:\/\//i.test(v) && !isImg(v) && !out.w) out.w = v;
  };
  const walk = (o) => {
    if (!o || typeof o !== "object" || seen.has(o)) return; seen.add(o);
    if (Array.isArray(o)) {
      for (const e of o) {
        if (e && typeof e === "object") {
          const n = String(e.type || e.name || e.platform || e.label || e.title || ""); const u = e.url || e.link || e.href || e.value;
          if (u && typeof u === "string") { if (/tele|^tg$/i.test(n)) out.tg ||= u; else if (/^(x|twitter)$/i.test(n)) out.x ||= u; else if (/web|site|home/i.test(n)) out.w ||= u; else put(u); }
          walk(e);
        } else put(e);
      }
      return;
    }
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string") {
        const val = v.trim(); if (!val || val.length > 300) continue;
        if (/t\.me\/|telegram\.(me|org)\//i.test(val) || /^(telegram|tg|telegram_url|tg_url)$/i.test(k)) out.tg ||= val;
        else if (/(^|\/\/|www\.)(x|twitter)\.com\//i.test(val) || /^(twitter|x|twitter_url|x_url|twitterurl)$/i.test(k)) out.x ||= val;
        else if (/^(website|web|homepage|site|website_url|external_url|url)$/i.test(k) && !isImg(val)) out.w ||= val;
      } else walk(v);
    }
  };
  walk(j);
  return out;
}

export function startLinks(pool, { log = console.log } = {}) {
  if (process.env.ELY_LINKS === "0") return;
  const BATCH = Number(process.env.ELY_LINKS_BATCH || 60), CONC = Number(process.env.ELY_LINKS_CONC || 6);
  let busy = false, done = 0, found = 0;
  const save = (addr, v) => pool.query("insert into ely_meta (k, v, updated_at) values ($1, $2, now()) on conflict (k) do update set v = excluded.v, updated_at = now()", [`links:${addr}`, JSON.stringify(v)]);
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const { rows } = await pool.query(
        `select t.address, t.uri from ely_tokens t left join ely_meta m on m.k = 'links:' || t.address
         where t.uri is not null and t.uri <> '' and (coalesce(t.vol24_hype, 0) > 0 or t.created_at > now() - interval '2 days')
           and (m.k is null or (m.v->>'fail' = 'true' and m.updated_at < now() - interval '15 minutes'))
         order by coalesce(t.vol24_hype, 0) desc, t.created_at desc nulls last limit $1`, [BATCH]);
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(CONC, rows.length) }, async () => {
        while (i < rows.length) {
          const r = rows[i++];
          try {
            const f = findLinks(await readMeta(r.uri));
            await save(r.address, { ...f, at: Date.now() }); done++; if (f.w || f.x || f.tg) found++;
          } catch { await save(r.address, { fail: true, at: Date.now() }).catch(() => {}); }
        }
      }));
      if (rows.length) log(`links: ${rows.length} coins read (${found} with links so far, ${done} done)`);
    } catch (e) { log(`links: ${e.message}`); } finally { busy = false; }
  };
  setInterval(tick, 15_000); setTimeout(tick, 5_000);
  // diagnostic only (nothing is saved, no link changes): ELY_LINKS_DEBUG=<address,address> prints what those coins' own metadata holds
  const dbg = String(process.env.ELY_LINKS_DEBUG || "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => /^0x[0-9a-f]{40}$/.test(x));
  if (dbg.length) setTimeout(async () => {
    for (const a of dbg) {
      try {
        const { rows } = await pool.query("select uri from ely_tokens where address = $1", [a]);
        const uri = rows[0]?.uri;
        if (!uri) { log(`links debug ${a}: no uri on this coin`); continue; }
        const j = await readMeta(uri);
        log(`links debug ${a}: uri=${String(uri).slice(0, 120)} found=${JSON.stringify(findLinks(j))} raw=${JSON.stringify(j).slice(0, 1500)}`);
      } catch (e) { log(`links debug ${a}: ${e.message}`); }
    }
  }, 20_000);
}
