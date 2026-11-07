// POST /api/image  { name, description } -> { dataUrl }  (square mascot logo for a coin)
// Tries several Workers AI image models in turn, so one model being busy or out of
// daily quota doesn't stop coin images. The error says why when every model fails.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const STYLES = [
  "Pixar-style 3D render, soft studio lighting, glossy subsurface materials",
  "high-end 3D collectible toy render, cinematic rim light",
  "polished 3D cartoon mascot render, octane lighting, depth of field",
  "clean premium vector mascot logo, bold shapes, crisp outline",
  "glossy 3D render with glowing teal neon accents, dark background",
];

function prompt(name, description, picture) {
  const n = String(name ?? "").replace(/[^\p{L}\p{N} .'!&-]/gu, "").slice(0, 24);
  const d = String(description ?? "").replace(/[^\p{L}\p{N} .,'!?&-]/gu, "").slice(0, 160);
  const p = String(picture ?? "").replace(/[^\p{L}\p{N} .,'!?&-]/gu, "").slice(0, 240);
  const style = STYLES[Math.floor(Math.random() * STYLES.length)];
  // the idea's own art direction when the AI wrote one; otherwise built from the name and story
  const subject = p || `Mascot for a meme coin called "${n}", glowing teal and gold Elysium paradise accents. ${d}`;
  return `${subject}. Crypto coin mascot logo, square app-icon composition, one centered character, head and shoulders, ${style}, rich detail, vibrant colors, smooth dark gradient background with a soft glow behind the subject, high contrast, ultra detailed, sharp focus, 4k, illustrated character not a photo of a real person, no text, no letters, no words, no watermark.`;
}

/** Turns a model output into a Response: bytes go out as the raw image (no base64 work, which can blow the
 *  tiny CPU budget of a free Worker), base64 text from the model goes out inside JSON. Null when empty. */
async function toResponse(out, model) {
  if (!out) return null;
  if (typeof out === "object" && typeof out.image === "string" && out.image.length > 1000) return json({ dataUrl: `data:image/jpeg;base64,${out.image}`, model });
  try {
    const bytes = out instanceof Uint8Array ? out : new Uint8Array(await new Response(out).arrayBuffer());
    if (bytes.length < 1000) return null;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    return new Response(bytes, { headers: { "content-type": png ? "image/png" : "image/jpeg", "cache-control": "no-store", "x-model": model } });
  } catch { return null; }
}

const MODELS = [
  ["@cf/black-forest-labs/flux-1-schnell", (p) => ({ prompt: p, steps: 4 })], // flux takes no seed (a new picture every call anyway)
  ["@cf/bytedance/stable-diffusion-xl-lightning", (p, seed) => ({ prompt: p, width: 512, height: 512, seed })],
  ["@cf/lykon/dreamshaper-8-lcm", (p, seed) => ({ prompt: p, width: 512, height: 512, seed })],
  ["@cf/stabilityai/stable-diffusion-xl-base-1.0", (p, seed) => ({ prompt: p, width: 512, height: 512, num_steps: 12, seed })],
];

/** Pollinations: free, keyless, slower and rate limited, so it's only the backup. */
async function backup(p, seed) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(p.slice(0, 400))}?width=512&height=512&nologo=true&seed=${seed}`, { signal: ctl.signal });
    if (!r.ok || !/^image\//.test(r.headers.get("content-type") || "")) return null;
    return await toResponse(new Uint8Array(await r.arrayBuffer()), "backup");
  } finally { clearTimeout(t); }
}

export async function onRequestPost({ request, env }) {
  try {
    return await draw(request, env);
  } catch (e) {
    // never answer with a crash page: the site always gets JSON it can show
    return json({ error: "Couldn't draw an image right now. Please try again.", code: "FAILED", detail: [String(e?.message || e).slice(0, 160)] }, 502);
  }
}

async function draw(request, env) {
  if (!env.AI) return json({ error: "AI images are not set up on this site yet.", code: "NO_AI_BINDING" }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const p = prompt(body.name, body.description, body.picture);
  const seed = Math.floor(Math.random() * 2_000_000_000); // a new picture every time
  const errors = [];
  const isQuota = (e) => /quota|limit|neurons|429|capacity/i.test(e);
  for (const [model, input] of MODELS) {
    try {
      const res = await toResponse(await env.AI.run(model, input(p, seed)), model.split("/").pop());
      if (res) return res;
      errors.push(`${model.split("/").pop()}: empty`);
    } catch (e) {
      errors.push(`${model.split("/").pop()}: ${String(e?.message || e).slice(0, 120)}`);
      if (isQuota(errors[errors.length - 1])) break; // every model shares the daily quota: go straight to the backup
    }
  }
  // Backup when today's Cloudflare AI quota is used up: a free public image service (no key).
  try {
    const res = await backup(p, seed);
    if (res) return res;
    errors.push("backup: empty");
  } catch (e) { errors.push(`backup: ${String(e?.message || e).slice(0, 120)}`); }
  const quota = errors.some(isQuota);
  return json({ error: quota ? "AI images reached today's limit. Upload your own image, or try again later." : "Couldn't draw an image right now. Please try again.", code: quota ? "QUOTA" : "FAILED", detail: errors }, 502);
}
