import Link from "next/link";
import type { LegalDoc } from "@/lib/legal";

export function LegalPage({ doc, other }: { doc: LegalDoc; other: { href: string; label: string } }) {
  return (
    <div className="wrap page" style={{ maxWidth: 1180 }}>
      <div className="row" style={{ gap: 40 }}>
        <aside className="hide-m" style={{ flex: "1 1 200px", maxWidth: 240, paddingTop: 8 }}>
          <nav className="doc-nav" aria-label="On this page">
            {doc.sections.map((s) => <a key={s.id} href={`#${s.id}`}>{s.h.replace(/^\d+\.\s*/, "")}</a>)}
          </nav>
        </aside>
        <article className="doc" style={{ flex: "999 1 560px", minWidth: 0, maxWidth: 760, display: "flex", flexDirection: "column", gap: 18 }}>
          <h1 className="h-title" style={{ fontSize: "clamp(34px, 5vw, 46px)" }}>{doc.title}</h1>
          <span className="mono" style={{ fontSize: 13, color: "var(--faint)" }}>Last updated {doc.updated}</span>
          <p style={{ fontSize: 17, color: "var(--note)" }}>{doc.intro}</p>
          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 10 }}>
              <h2>{s.h}</h2>
              {s.p.map((t, i) => <p key={i}>{t}</p>)}
            </section>
          ))}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 16 }}>
            <Link href={other.href} className="btn">{other.label}</Link>
            <Link href="/help/" className="btn ghost">Help centre</Link>
          </div>
        </article>
      </div>
    </div>
  );
}
