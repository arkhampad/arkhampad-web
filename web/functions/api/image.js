// POST /api/image  { name, description } -> { dataUrl }  (square mascot logo for a coin)
// Tries several Workers AI image models in turn, so one model being busy or out of
// daily quota doesn't stop coin images. The error says why when every model fails.
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

/** Turns any model output (base64 field, bytes, stream) into a data URL, or null. */
async function toDataUrl(out) {
  if (!out) return null;
  if (typeof out === "object" && typeof out.image === "string" && out.image.length > 1000) return `data:image/jpeg;base64,${out.image}`;
  try {
    const bytes = out instanceof Uint8Array ? out : new Uint8Array(await new Response(out).arrayBuffer());
    if (bytes.length < 1000) return null;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    return `data:image/${png ? "png" : "jpeg"};base64,${b64(bytes)}`;
  } catch { return null; }
}

const MODELS = [
  ["@cf/black-forest-labs/flux-1-schnell", (p) => ({ prompt: p, steps: 4 })],
  ["@cf/bytedance/stable-diffusion-xl-lightning", (p) => ({ prompt: p, width: 512, height: 512 })],
  ["@cf/lykon/dreamshaper-8-lcm", (p) => ({ prompt: p, width: 512, height: 512 })],
  ["@cf/stabilityai/stable-diffusion-xl-base-1.0", (p) => ({ prompt: p, width: 512, height: 512, num_steps: 12 })],
];

export async function onRequestPost({ request, env }) {
  if (!env.AI) return json({ error: "AI images are not set up on this site yet.", code: "NO_AI_BINDING" }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const p = prompt(body.name, body.description);
  const errors = [];
  for (const [model, input] of MODELS) {
    try {
      const url = await toDataUrl(await env.AI.run(model, input(p)));
      if (url) return json({ dataUrl: url, model });
      errors.push(`${model.split("/").pop()}: empty`);
    } catch (e) { errors.push(`${model.split("/").pop()}: ${String(e?.message || e).slice(0, 120)}`); }
  }
  const quota = errors.some((e) => /quota|limit|neurons|429|capacity/i.test(e));
  return json({ error: quota ? "AI images reached today's limit. Upload your own image, or try again later." : "Couldn't draw an image right now. Please try again.", code: quota ? "QUOTA" : "FAILED", detail: errors }, 502);
}
