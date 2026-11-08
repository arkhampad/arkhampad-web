// /api/revenue: GET returns ElyScreener's paid promotions and swap hashes for /ops (read-only).
const SB_URL = "https://yvdudswzmdziwnfurwir.supabase.co";
const SB_KEY = "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
export async function onRequestGet({ env }) {
  const k = env.NEXT_PUBLIC_SUPABASE_KEY || SB_KEY;
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL || SB_URL}/rest/v1/rpc/ap_es_revenue`, { method: "POST", headers: { apikey: k, authorization: `Bearer ${k}`, "content-type": "application/json", accept: "application/json" }, body: "{}" }).catch(() => null);
  return new Response(r ? await r.text() : "{}", { status: r?.ok ? 200 : 502, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
