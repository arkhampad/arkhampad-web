import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CATS, LEARN_DATE, POSTS, postBySlug } from "@/lib/learn";
import { Md } from "@/components/ely/md";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = postBySlug(slug);
  if (!p) return {};
  return {
    title: p.title,
    description: p.desc,
    keywords: p.keywords,
    alternates: { canonical: `/learn/${slug}/` },
    openGraph: { title: p.title, description: p.desc, type: "article", url: `/learn/${slug}/`, publishedTime: LEARN_DATE, modifiedTime: LEARN_DATE },
    twitter: { card: "summary_large_image", title: p.title, description: p.desc },
  };
}

const anchor = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = postBySlug(slug);
  if (!p) notFound();
  const url = `https://arkhampad.com/learn/${slug}/`;
  const related = p.related.map(postBySlug).filter((x): x is NonNullable<typeof x> => !!x);
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: p.title,
      description: p.desc,
      keywords: p.keywords.join(", "),
      datePublished: LEARN_DATE,
      dateModified: LEARN_DATE,
      mainEntityOfPage: url,
      image: "https://arkhampad.com/og.png",
      author: { "@type": "Organization", name: "ArkhamPad", url: "https://arkhampad.com" },
      publisher: { "@type": "Organization", name: "ArkhamPad", logo: { "@type": "ImageObject", url: "https://arkhampad.com/icon-512.png" } },
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: p.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "") } })) },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Learn", item: "https://arkhampad.com/learn/" },
        { "@type": "ListItem", position: 2, name: p.title, item: url },
      ],
    },
  ];
  return (
    <main className="e-in e-page e-learn">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <div className="e-agrid">
        <article className="e-article">
          <nav className="e-crumb" aria-label="Breadcrumb"><Link href="/learn/">Learn</Link><span>/</span><span>{CATS[p.cat]}</span></nav>
          <h1>{p.title}</h1>
          <div className="e-ameta dim">{p.read} read · Updated {new Date(LEARN_DATE).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
          <div className="e-short"><b>In short</b><p>{p.short}</p></div>
          {p.sections.map(([h, body]) => (
            <section key={h} id={anchor(h)}>
              <h2>{h}</h2>
              <Md text={body} />
            </section>
          ))}
          <div className="e-cta">
            <div>
              <b>Trade or launch on Elysium</b>
              <span>Every Elysium token on one screen. Log in with email or Google, pay with HYPE or USDC.</span>
            </div>
            <div className="e-cta-btns">
              <Link href="/" className="e-btn pri">Discover tokens</Link>
              <Link href="/create/" className="e-btn">Create a coin</Link>
            </div>
          </div>
          <section id="faq">
            <h2>Frequently asked questions</h2>
            {p.faq.map(([q, a]) => (
              <details key={q} className="e-faq">
                <summary>{q}</summary>
                <Md text={a} />
              </details>
            ))}
          </section>
          {related.length > 0 && (
            <section>
              <h2>Read next</h2>
              <div className="e-lgrid">
                {related.map((r) => (
                  <Link key={r.slug} href={`/learn/${r.slug}/`} className="e-lcard">
                    <b>{r.title}</b>
                    <span>{r.desc}</span>
                    <small className="dim">{r.read} read</small>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </article>
        <aside className="e-toc" aria-label="On this page">
          <span className="dim">On this page</span>
          {p.sections.map(([h]) => <a key={h} href={`#${anchor(h)}`}>{h}</a>)}
          <a href="#faq">FAQ</a>
        </aside>
      </div>
    </main>
  );
}
