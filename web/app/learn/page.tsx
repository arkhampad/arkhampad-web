import type { Metadata } from "next";
import Link from "next/link";
import { CATS, POSTS, type Cat } from "@/lib/learn";

export const metadata: Metadata = {
  title: "Learn Elysium: guides to trade and create tokens",
  description: "Plain-English guides to Elysium, Kinetiq's Layer 2 for Hyperliquid: bridging HYPE, buying Elysium tokens, creating a coin, creator fees and staying safe.",
  alternates: { canonical: "/learn/" },
  openGraph: { title: "Learn Elysium · ArkhamPad", description: "Guides to trade and create tokens on Elysium.", url: "/learn/", type: "website" },
};

const ORDER: Cat[] = ["elysium", "money", "trade", "create", "safety"];

export default function Learn() {
  const ld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Learn Elysium",
    url: "https://arkhampad.com/learn/",
    hasPart: POSTS.map((p) => ({ "@type": "Article", headline: p.title, url: `https://arkhampad.com/learn/${p.slug}/` })),
  };
  return (
    <main className="e-in e-page e-learn">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <section className="e-hero">
        <div>
          <span className="e-eyebrow">Learn</span>
          <h1>Guides to Elysium</h1>
          <p>Everything you need to trade and create tokens on Elysium, explained in plain English.</p>
        </div>
      </section>
      {ORDER.map((c) => {
        const list = POSTS.filter((p) => p.cat === c);
        if (!list.length) return null;
        return (
          <section key={c}>
            <div className="e-sec-h"><h2>{CATS[c]}</h2><span className="dim" style={{ fontSize: 12.5 }}>{list.length} guides</span></div>
            <div className="e-lgrid">
              {list.map((p) => (
                <Link key={p.slug} href={`/learn/${p.slug}/`} className="e-lcard">
                  <b>{p.title}</b>
                  <span>{p.desc}</span>
                  <small className="dim">{p.read} read</small>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
