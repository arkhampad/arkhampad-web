// Small, fast keyword search over Learn articles and Help answers.
// Used by the Help and Learn pages (instant results) and by /api/ask (context for AI).
import { guides } from "./guides";
import { fees, help, promotePrices } from "./help";

export type Hit = { kind: "guide" | "help"; title: string; url: string; text: string; score: number };

const STOP = new Set("a an and are as at be by can do does for from how i if in is it its me my of on or so that the this to what when where which who why will with you your".split(" "));
export const tokens = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

type Doc = { kind: Hit["kind"]; title: string; url: string; text: string; head: string[]; body: string[] };
let index: Doc[] | null = null;
function build(): Doc[] {
  const docs: Doc[] = [];
  for (const g of guides) {
    const text = [g.short, ...g.sections.map(([h, p]) => `${h}: ${p}`), ...g.faq.map(([q, a]) => `${q} ${a}`)].join("\n");
    docs.push({ kind: "guide", title: g.title, url: `/learn/${g.slug}/`, text, head: tokens(`${g.title} ${g.desc}`), body: tokens(text) });
  }
  for (const t of help) {
    for (const [q, a] of t.items) docs.push({ kind: "help", title: q, url: `/help/#${t.id}`, text: `${q} ${a}`, head: tokens(`${q} ${t.title}`), body: tokens(a) });
  }
  const feeText = [...fees.map((f) => `${f.what}: ${f.fee}. ${f.note}`), `Promote: ${promotePrices.map(([d, p]) => `${d} ${p}`).join(", ")}.`].join("\n");
  docs.push({ kind: "help", title: "Fees on ArkhamPad", url: "/help/#fees", text: feeText, head: tokens("fees fee cost costs price prices pricing charge charges commission how much"), body: tokens(feeText) });
  return docs;
}

/** Every Help answer plus the fee list, for questions keyword search can't match (e.g. other languages). */
export function helpDigest(): string {
  const lines = help.flatMap((t) => t.items.map(([q, a]) => `${q} ${a}`));
  lines.push(...fees.map((f) => `Fee - ${f.what}: ${f.fee}. ${f.note}`));
  return lines.join("\n");
}

// a word matches when one starts with the other ("withdraw" ~ "withdrawal")
const hit = (w: string, list: string[]) => list.some((x) => x === w || (w.length > 3 && x.length > 3 && (x.startsWith(w) || w.startsWith(x))));

export function search(q: string, limit = 6): Hit[] {
  const words = [...new Set(tokens(q))];
  if (!words.length) return [];
  if (!index) index = build();
  const out: Hit[] = [];
  for (const d of index) {
    let score = 0, matched = 0;
    for (const w of words) {
      const h = hit(w, d.head), b = hit(w, d.body);
      if (h || b) matched++;
      score += (h ? 3 : 0) + (b ? 1 : 0);
    }
    if (!score) continue;
    score *= matched / words.length; // reward answers that cover the whole question
    if (d.kind === "help") score *= 1.1; // short direct answers first on ties
    out.push({ kind: d.kind, title: d.title, url: d.url, text: d.text, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
