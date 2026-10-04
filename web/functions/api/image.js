// POST /api/image  { name, description } -> { dataUrl }  (square mascot logo for a coin)
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function prompt(name, description) {
  const n = String(name ?? "").replace(/[^\p{L}\p{N} .'!&-]/gu, "").slice(0, 24);
  const d = String(description ?? "").replace(/[^\p{L}\p{N} .,'!?&-]/gu, "").slice(0, 160);
  return `Mascot logo for a meme coin called "${n}". ${d} Single cute character, centered, bold vivid colors, clean flat cartoon illustration, simple solid background, high contrast, no text, no letters, no watermark.`;
}

export async function onRequestPost({ request, env }) {
  if (!env.AI) return json({ error: "AI images are not available right now." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const p = prompt(body.name, body.description);
  try {
    const out = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: p, steps: 6 });
    if (out?.image) return json({ dataUrl: `data:image/jpeg;base64,${out.image}` });
  } catch { /* fall back below */ }
  try {
    const stream = await env.AI.run("@cf/bytedance/stable-diffusion-xl-lightning", { prompt: p });
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    if (bytes.length > 1000) return json({ dataUrl: `data:image/png;base64,${b64(bytes)}` });
  } catch { /* nothing else to try */ }
  return json({ error: "Couldn't draw an image right now. Please try again." }, 502);
}
