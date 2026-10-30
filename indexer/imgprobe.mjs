// Where do other Elysium launchpads keep their coin pictures? (they don't put them on-chain)
// Fetches each site and its scripts and prints API paths, image hosts and per-token og:image tags.
//   node imgprobe.mjs        (run through: elysium probe workflow with rpc = "images")
import { appendFileSync } from "node:fs";

const SITES = ["https://boxa.club", "https://kleos.fun", "https://kleos.xyz", "https://kleos.app", "https://kleos.so", "https://elyspump.fun", "https://elyspump.xyz", "https://elyspump.com", "https://elys.fun", "https://ronspad.fun"];
const SAMPLE = { boxa: "0xa3c1d6a8648df3978a38ce1478fbc284c75d95d7", kleos: "0x0d7c2ac2a5ab4a3aa7f8f4f8f1c5b3d0f2f2b9a1", elys: "0xa0a9a4d296e948c5a0b1e5bb93e6d63111541f7a" };
const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" };
const out = [];
const log = (s) => { console.log(s); out.push(s); };
const get = async (u) => { try { const r = await fetch(u, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(12000) }); return { s: r.status, url: r.url, t: r.ok ? (await r.text()).slice(0, 4_000_000) : "" }; } catch (e) { return { s: 0, t: "", e: String(e.message).slice(0, 80) }; } };

for (const site of SITES) {
  const home = await get(site);
  log(`\n## ${site} → ${home.s} ${home.url || home.e || ""}`);
  if (!home.t) continue;
  const og = home.t.match(/property="og:image"\s+content="([^"]+)"/i)?.[1];
  if (og) log(`og:image ${og}`);
  const scripts = [...new Set([...home.t.matchAll(/<script[^>]+src="([^"]+)"/gi)].map((m) => new URL(m[1], home.url || site).href))].slice(0, 25);
  log(`scripts: ${scripts.length}`);
  const found = new Set();
  for (const js of [home.url || site, ...scripts]) {
    const r = js === (home.url || site) ? home : await get(js);
    for (const m of r.t.matchAll(/["'`](\/api\/[A-Za-z0-9_\-/.:${}]{2,80})["'`]/g)) found.add(`path ${m[1]}`);
    for (const m of r.t.matchAll(/https?:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9_\-/.:${}]*)?/g)) {
      const u = m[0];
      if (/supabase|ipfs|pinata|cloudinary|imagedelivery|r2\.|storage|cdn|img|image|upload|api\.|\/api\/|firebase|blob\.|amazonaws/i.test(u) && !/w3\.org|reactjs|github|google|fonts|walletconnect|privy|sentry|vercel-insights/i.test(u)) found.add(`url ${u.slice(0, 140)}`);
    }
    for (const m of r.t.matchAll(/["'`]((?:image|imageUrl|image_url|logo|logoUrl|icon|avatar|metadataUri|metadata_uri|uri)["'`]?\s*:)/g)) found.add(`field ${m[1]}`);
  }
  for (const f of [...found].slice(0, 80)) log(f);
  // per-token pages: og:image often is the coin picture
  const base = home.url ? new URL(home.url).origin : site;
  for (const a of Object.values(SAMPLE)) {
    for (const p of [`/token/${a}`, `/t/${a}`, `/coin/${a}`, `/tokens/${a}`, `/trade/${a}`, `/t/?a=${a}`, `/api/token/${a}`, `/api/tokens/${a}`, `/api/coin/${a}`, `/api/token?address=${a}`]) {
      const r = await get(base + p);
      if (r.s && r.s !== 404) {
        const img = r.t.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] || r.t.match(/"(?:image|imageUrl|image_url|logo)"\s*:\s*"([^"]+)"/)?.[1];
        log(`${p.replace(a, "<addr>")} → ${r.s}${img ? ` img ${img.slice(0, 160)}` : ""}${r.t.startsWith("{") || r.t.startsWith("[") ? ` json ${r.t.slice(0, 200).replace(/\s+/g, " ")}` : ""}`);
      }
    }
  }
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "```\n" + out.join("\n") + "\n```\n");
