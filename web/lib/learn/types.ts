// Learn articles (Elysium). Body text uses a tiny markdown subset, rendered by components/ely/learn.tsx:
//   blank line = new paragraph · "- " bullet · "1. " numbered step · **bold** · [text](/learn/slug/) link
export type Cat = "elysium" | "money" | "trade" | "create" | "safety";
export type Post = {
  slug: string;
  cat: Cat;
  title: string; // <= 65 chars, main keyword first
  desc: string; // meta description, 140-160 chars
  keywords: string[]; // 8-14 long-tail phrases this page answers
  read: string; // "6 min"
  short: string; // 2-3 sentence direct answer (shown first; what AI answer engines quote)
  sections: [string, string][]; // [heading, body]
  faq: [string, string][]; // 4-6 real questions people search
  related: string[]; // 3 slugs
};
export const CATS: Record<Cat, string> = { elysium: "Elysium basics", money: "Deposits & withdrawals", trade: "Trading", create: "Create a coin", safety: "Safety" };
