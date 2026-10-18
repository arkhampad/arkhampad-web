/**
 * /geo: where the visitor is (Cloudflare's country and region) and whether futures are offered
 * there (lib/hlgeo.js). The Futures page asks this before showing trading.
 */
import { perpsBlocked } from "../lib/hlgeo.js";

export async function onRequestGet(ctx) {
  const cf = ctx.request.cf || {};
  const country = String(cf.country || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  const region = String(cf.regionCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  return new Response(JSON.stringify({ country, region, futures: !perpsBlocked(country, region) }), {
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}
