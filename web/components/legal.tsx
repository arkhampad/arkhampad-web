import Link from "next/link";
import type { LegalDoc } from "@/lib/legal";

export function LegalPage({ doc, other }: { doc: LegalDoc; other: { href: string; label: string } }) {
  return (
    <main className="e-in e-page e-learn">
      <div className="e-agrid">
        <article className="e-article">
          <h1>{doc.title}</h1>
          <div className="e-ameta dim">Last updated {doc.updated}</div>
          <p>{doc.intro}</p>
          {doc.sections.map((s) => (
            <section key={s.id} id={s.id}>
              <h2>{s.h}</h2>
              {s.p.map((t, i) => <p key={i}>{t}</p>)}
            </section>
          ))}
          <div className="e-cta-btns" style={{ paddingTop: 12 }}>
            <Link href={other.href} className="e-btn">{other.label}</Link>
            <Link href="/learn/" className="e-btn">Guides</Link>
          </div>
        </article>
        <aside className="e-toc" aria-label="On this page">
          <span className="dim">On this page</span>
          {doc.sections.map((s) => <a key={s.id} href={`#${s.id}`}>{s.h.replace(/^\d+\.\s*/, "")}</a>)}
        </aside>
      </div>
    </main>
  );
}
