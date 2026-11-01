// POST /api/ely-upload (body: the picture's bytes, content-type image/gif | image/webp | image/png)
// -> { url } for an animated coin picture. Up to 2 MB; 30 uploads per visitor per day.
// The picture is stored in Supabase (db/032_ely_images.sql) and served, cached, by /api/ely-file.
const SB_URL = "https://yvdudswzmdziwnfurwir.supabase.co";
const SB_KEY = "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
const MAX = 2_000_000;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function kind(b) {
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif"; // GIF8
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp"; // RIFF..WEBP
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  return null;
}

export async function onRequestPost({ request, env }) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL || SB_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_KEY || SB_KEY;
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX) return json({ error: "That picture is over 2 MB. Try a smaller GIF." }, 413);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length || buf.length > MAX) return json({ error: "That picture is over 2 MB. Try a smaller GIF." }, 413);
  const mime = kind(buf);
  if (!mime) return json({ error: "Use a GIF, WebP or PNG picture." }, 400);
  // daily limit per visitor (shared counter with the AI ideas table, different key)
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  try {
    const r = await fetch(`${base}/rest/v1/rpc/ely_ai_take`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ p_key: `up:${ip}` }) });
    if (r.ok && Number(await r.json()) > 30) return json({ error: "Too many uploads today. Try again tomorrow." }, 429);
  } catch {}
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((x) => x.toString(16).padStart(2, "0")).join("");
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const r = await fetch(`${base}/rest/v1/rpc/ely_img_put`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ p_hash: hash, p_mime: mime, p_data: btoa(bin) }) });
  if (!r.ok || (await r.json()) !== true) return json({ error: "Couldn't save the picture. Try again." }, 502);
  return json({ url: `https://arkhampad.com/api/ely-file?h=${hash}` });
}
