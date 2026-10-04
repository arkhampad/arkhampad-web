import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { catLabel, guides } from "@/lib/mock";
import { articles } from "@/lib/guides";

export function generateStaticParams() { return guides.map((g) => ({ slug: g.slug })); }
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params; const g = guides.find((x) => x.slug === slug);
  if (!g) return {};
  return { title: g.title, description: articles[slug]?.short || g.desc, alternates: { canonical: `/learn/${slug}/` } };
}

export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const g = guides.find((x) => x.slug === slug); const a = articles[slug];
  if (!g || !a) notFound();
  const ld = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: a.faq.map(([q, ans]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: ans } })) };
  const related = guides.filter((x) => x.cat === g.cat && x.slug !== slug).slice(0, 3);
  return (
    <div className="wrap page" style={{ maxWidth: 1180 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <div className="row" style={{ gap: 40 }}>
        <aside className="hide-m" style={{ flex: "1 1 200px", maxWidth: 240, display: "flex", flexDirection: "column", gap: 12, paddingTop: 120, position: "sticky", top: 80 }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>On this page</span>
          <a href="#in-short" className="volt" style={{ fontSize: 13 }}>In short</a>
          {a.sections.map(([h], i) => <a key={h} href={`#s${i}`} className="muted" style={{ fontSize: 13 }}>{h}</a>)}
          <a href="#faq" className="muted" style={{ fontSize: 13 }}>FAQ</a>
        </aside>
        <article style={{ flex: "999 1 560px", minWidth: 0, maxWidth: 760, display: "flex", flexDirection: "column", gap: 18 }}>
          <Link href="/learn/" className="dim" style={{ fontSize: 13 }}>← Learn / {catLabel[g.cat]}</Link>
          <h1 style={{ margin: 0, fontSize: "clamp(32px, 5vw, 46px)", lineHeight: 1.08, fontWeight: 900, letterSpacing: "-0.035em" }}>{g.title}</h1>
          <span className="mono" style={{ fontSize: 13, color: "var(--faint)" }}>{g.read} read</span>
          <div style={{ height: 220, borderRadius: 22, background: `linear-gradient(135deg, ${g.c1}, ${g.c2})`, position: "relative", overflow: "hidden" }}><span style={{ position: "absolute", right: -40, bottom: -60, width: 300, height: 300, borderRadius: "50%", border: "36px solid rgba(10,11,16,0.12)" }} /></div>
          <div id="in-short" style={{ padding: "18px 20px", borderRadius: 18, background: "rgba(212,255,58,0.06)", border: "1px solid rgba(212,255,58,0.22)", display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="mono volt" style={{ fontWeight: 700, fontSize: 12 }}>In short</span>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: "var(--note)" }}>{a.short}</p>
          </div>
          {a.sections.map(([h, p], i) => (
            <section key={h} id={`s${i}`} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 style={{ margin: "12px 0 0", fontSize: 26, fontWeight: 800, letterSpacing: -0.6 }}>{h}</h2>
              <p style={{ margin: 0, fontSize: 17, lineHeight: 1.75, color: "var(--text2)", maxWidth: "68ch" }}>{p}</p>
            </section>
          ))}
          <h2 id="faq" style={{ margin: "12px 0 0", fontSize: 26, fontWeight: 800, letterSpacing: -0.6 }}>FAQ</h2>
          {a.faq.map(([q, ans]) => (
            <details key={q} className="card" style={{ padding: "16px 18px", borderRadius: 14 }}><summary style={{ fontWeight: 700, fontSize: 15, cursor: "pointer" }}>{q}</summary><p className="muted" style={{ margin: "10px 0 0", fontSize: 15, lineHeight: 1.6 }}>{ans}</p></details>
          ))}
          {related.length > 0 && <>
            <h2 style={{ margin: "16px 0 0", fontSize: 20, fontWeight: 800 }}>Related guides</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{related.map((r) => <Link key={r.slug} href={`/learn/${r.slug}/`} className="card" style={{ padding: "14px 16px", flexDirection: "row", justifyContent: "space-between" }}><span style={{ fontWeight: 700 }}>{r.title}</span><span className="mono dim" style={{ fontSize: 12 }}>{r.read}</span></Link>)}</div>
          </>}
        </article>
      </div>
    </div>
  );
}
