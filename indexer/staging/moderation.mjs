// Comment moderation for the relayer. The site's /api/moderate runs the same rules plus AI;
// these rules are the local fallback when the site can't be reached (keep in step with web/lib/moderation.ts).
const RULES = [
  [/\b(seed|recovery|secret)\s*(phrase|words?)\b|\bprivate\s*key\b|\b12\s*words\b/i, "asks for wallet secrets"],
  [/\b(connect|link|verify|sync|validate)\s+(your\s+)?wallet\b/i, "asks you to connect a wallet"],
  [/\b(airdrop|giveaway|free\s+(usdc|usdt|eth|tokens?|coins?|money))\b/i, "promises free tokens"],
  [/\b(send|transfer)\s+(me|us)\b|\bdouble\s+your\b|\bguaranteed\s+(profit|returns?|x\d+)\b/i, "asks for funds or promises returns"],
  [/\b(dm|message|contact|text)\s+(me|us)\b|\bwhats\s?app\b|\btelegram\s*[:@]/i, "moves you to private messages"],
  [/\b(official\s+)?(support|admin|help\s*desk)\s+(team|here|agent)\b/i, "pretends to be support"],
  [/\b[a-z0-9-]{2,}\s*(\.|\(dot\)|\[dot\])\s*(xyz|top|io|com|net|org|app|site|online|live|vip|club|fun|claims?|link)\b/i, "contains a web address"],
  [/0x[a-fA-F0-9]{40}.*\b(send|deposit|transfer)\b|\b(send|deposit|transfer)\b.*0x[a-fA-F0-9]{40}/i, "asks you to send to an address"],
];

export function ruleCheck(text) {
  const t = String(text).replace(/\barkhampad\s*\.\s*com\b/gi, "ArkhamPad");
  for (const [re, why] of RULES) if (re.test(t)) return { spam: true, reason: why };
  if (/(.)\1{14,}/.test(t)) return { spam: true, reason: "looks like spam" };
  return { spam: false, reason: null };
}

const SITE = (process.env.SITE_URL || "https://arkhampad.com").replace(/\/$/, "");

/** Rules first; then the site's AI check with a short timeout. Never throws. */
export async function moderate(text) {
  const rule = ruleCheck(text);
  if (rule.spam) return rule;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch(`${SITE}/api/moderate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return rule;
    const j = await r.json();
    return j && j.spam === true ? { spam: true, reason: String(j.reason || "looks like a scam").slice(0, 60) } : { spam: false, reason: null };
  } catch { return rule; }
}
