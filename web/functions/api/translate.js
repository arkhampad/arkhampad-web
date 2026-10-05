// POST /api/translate { text, to } -> { text, from }  Translates a comment; the same text + language is cached at the edge.
import { ask, cached, json, parseObj, readJson } from "../../lib/ai.ts";

const NAMES = { en: "English", tr: "Turkish", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", it: "Italian", ru: "Russian", uk: "Ukrainian", ar: "Arabic", fa: "Persian", hi: "Hindi", id: "Indonesian", vi: "Vietnamese", th: "Thai", zh: "Chinese", ja: "Japanese", ko: "Korean", nl: "Dutch", pl: "Polish" };

export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  const text = String(b?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const to = String(b?.to ?? "en").toLowerCase().slice(0, 2);
  const target = NAMES[to] ?? "English";
  if (!text) return json({ error: "Nothing to translate." }, 400);
  return cached(`tr|${to}|${text}`, 86400 * 7, async () => {
    const out = parseObj(await ask(env,
      `Translate the user's message into ${target}. It is a casual comment on a crypto meme coin page: keep slang, tickers ($ABC), numbers and emojis as they are.
Reply with JSON only: {"from":"name of the original language in English","text":"the translation"}. If it is already in ${target}, return it unchanged.`,
      text, { max: 260, temp: 0.1 }));
    const t = typeof out?.text === "string" ? out.text.trim().slice(0, 600) : "";
    if (!t) return [json({ error: "Translation isn't available right now." }, 503), false];
    return [json({ text: t, from: typeof out?.from === "string" ? out.from.replace(/[^A-Za-z ]/g, "").slice(0, 24) : "" }), true];
  });
}
