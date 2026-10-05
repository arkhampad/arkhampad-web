// Scam and spam patterns for comments. Used by /api/moderate (with AI) and kept in step with the relayer's copy.
const RULES: [RegExp, string][] = [
  [/\b(seed|recovery|secret)\s*(phrase|words?)\b|\bprivate\s*key\b|\b12\s*words\b/i, "asks for wallet secrets"],
  [/\b(connect|link|verify|sync|validate)\s+(your\s+)?wallet\b/i, "asks you to connect a wallet"],
  [/\b(airdrop|giveaway|free\s+(usdc|usdt|eth|tokens?|coins?|money))\b/i, "promises free tokens"],
  [/\b(send|transfer)\s+(me|us)\b|\bdouble\s+your\b|\bguaranteed\s+(profit|returns?|x\d+)\b/i, "asks for funds or promises returns"],
  [/\b(dm|message|contact|text)\s+(me|us)\b|\bwhats\s?app\b|\btelegram\s*[:@]/i, "moves you to private messages"],
  [/\b(official\s+)?(support|admin|help\s*desk)\s+(team|here|agent)\b/i, "pretends to be support"],
  [/\b[a-z0-9-]{2,}\s*(\.|\(dot\)|\[dot\])\s*(xyz|top|io|com|net|org|app|site|online|live|vip|club|fun|claims?|link)\b/i, "contains a web address"],
  [/0x[a-fA-F0-9]{40}.*\b(send|deposit|transfer)\b|\b(send|deposit|transfer)\b.*0x[a-fA-F0-9]{40}/i, "asks you to send to an address"],
];

export function ruleCheck(text: string): { spam: boolean; reason: string | null } {
  const t = text.replace(/\barkhampad\s*\.\s*com\b/gi, "ArkhamPad");
  for (const [re, why] of RULES) if (re.test(t)) return { spam: true, reason: why };
  if (/(.)\1{14,}/.test(t)) return { spam: true, reason: "looks like spam" };
  return { spam: false, reason: null };
}

/** Rough check for a comment in another language than English (shows the Translate button). */
export function looksForeign(text: string, browserLang = "en"): boolean {
  if (!browserLang.toLowerCase().startsWith("en")) return text.replace(/[^\p{L}]/gu, "").length >= 6;
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 6) return false;
  const nonAscii = letters.replace(/[A-Za-z]/g, "").length;
  if (nonAscii / letters.length > 0.12) return true;
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length < 4) return false;
  const EN = new Set("the a an and or is are was be to of in on for with this that it i you we they my your our not no yes but so just what when how if do does did have has will can buy sell hold coin dev moon gm lfg ser wen pump dump chart send it nice good great".split(" "));
  return words.filter((w) => EN.has(w)).length / words.length < 0.15;
}
