// /api/funnel: POST {a: address, s: step} records how far a new wallet got (once per wallet per step);
// GET returns the totals per step for /ops. Only totals ever leave the database.
const SB_URL = "https://yvdudswzmdziwnfurwir.supabase.co";
const SB_KEY = "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
const rpc = (env, fn, body) => {
  const k = env.NEXT_PUBLIC_SUPABASE_KEY || SB_KEY;
  return fetch(`${env.NEXT_PUBLIC_SUPABASE_URL || SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: k, authorization: `Bearer ${k}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(8000) });
};
export async function onRequestPost({ request, env }) {
  const t = await request.text();
  if (t.length > 300) return new Response("too big", { status: 413 });
  let j; try { j = JSON.parse(t); } catch { return new Response("bad", { status: 400 }); }
  if (!/^0x[0-9a-fA-F]{40}$/.test(j?.a || "") || !/^[a-z_]{3,20}$/.test(j?.s || "")) return new Response("bad", { status: 400 });
  await rpc(env, "ap_funnel_hit", { p_addr: j.a, p_step: j.s }).catch(() => null);
  return new Response(null, { status: 204 });
}
export async function onRequestGet({ env }) {
  const r = await rpc(env, "ap_funnel_stats").catch(() => null);
  return new Response(r ? await r.text() : "[]", { status: r?.ok ? 200 : 502, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
