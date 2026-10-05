import type { Metadata } from "next";
import Link from "next/link";
import { AskBox } from "@/components/ask";
import { CONTACT_EMAIL, fees, help, promotePrices } from "@/lib/help";

export const metadata: Metadata = {
  title: "Help",
  description: "Answers about logging in, deposits and withdrawals, trading, creating coins, alerts, invites and fees on ArkhamPad.",
  alternates: { canonical: "/help/" },
};

export default function Help() {
  const ld = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: help.flatMap((t) => t.items).map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  return (
    <div className="wrap page" style={{ maxWidth: 1180 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, paddingTop: 12 }}>
        <h1 className="h-title" style={{ fontSize: "clamp(36px, 5vw, 52px)" }}>How can we help?</h1>
        <p className="h-sub" style={{ maxWidth: 560, fontSize: 17 }}>Search the answers below, or ask AI and get a reply from our guides in seconds.</p>
        <AskBox id="help-q" placeholder="e.g. my withdrawal hasn't arrived" />
      </div>

      <div className="row" style={{ gap: 40, marginTop: 12 }}>
        <aside className="hide-m" style={{ flex: "1 1 200px", maxWidth: 230 }}>
          <nav className="doc-nav" aria-label="Help topics">
            {help.map((t) => <a key={t.id} href={`#${t.id}`}>{t.title}</a>)}
            <a href="#fees">Fees</a>
            <a href="#contact">Contact</a>
          </nav>
        </aside>
        <div className="doc" style={{ flex: "999 1 560px", minWidth: 0, maxWidth: 780, display: "flex", flexDirection: "column", gap: 36 }}>
          <div className="hscroll show-m" style={{ gap: 6 }}>
            {help.map((t) => <a key={t.id} href={`#${t.id}`} className="chip sm" style={{ display: "inline-flex", alignItems: "center" }}>{t.title}</a>)}
            <a href="#fees" className="chip sm" style={{ display: "inline-flex", alignItems: "center" }}>Fees</a>
          </div>

          {help.map((t) => (
            <section key={t.id} id={t.id} style={{ display: "flex", flexDirection: "column", scrollMarginTop: 96 }}>
              <h2 style={{ marginBottom: 6 }}>{t.title}</h2>
              {t.items.map(([q, a]) => (
                <details key={q} className="qa"><summary>{q}</summary><p>{a}</p></details>
              ))}
            </section>
          ))}

          <section id="fees" style={{ display: "flex", flexDirection: "column", gap: 14, scrollMarginTop: 96 }}>
            <h2>Fees</h2>
            <p>Fees are taken automatically by the smart contracts when a transaction happens. There are no subscriptions and no hidden charges.</p>
            <div style={{ borderRadius: 18, border: "1px solid var(--line)", background: "var(--bg2)", overflow: "hidden" }}>
              {fees.map((f) => (
                <div key={f.what} className="fee-row">
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{f.what}</span>
                  <span className="mono" style={{ fontWeight: 800, fontSize: 14, color: "var(--volt-ink)" }}>{f.fee}</span>
                  <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{f.note}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <b style={{ fontSize: 14 }}>Promote</b>
              {promotePrices.map(([d, p]) => <span key={d} className="pill" style={{ background: "var(--raise)", color: "var(--text2)", fontSize: 13 }}>{d} · <b className="mono" style={{ color: "var(--text)" }}>{p}</b></span>)}
            </div>
            <p style={{ fontSize: 14 }}>Full details are in the <Link href="/terms/#fees" className="volt">Terms of Use</Link>.</p>
          </section>

          <section id="contact" className="card" style={{ gap: 10, scrollMarginTop: 96, padding: 22 }}>
            <h2 style={{ fontSize: 20 }}>Still stuck?</h2>
            <p style={{ fontSize: 15 }}>Email us with your wallet address (never your seed phrase) and, if it&apos;s about a transaction, the transaction link. We reply as fast as we can.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <a className="btn volt" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              <a className="btn" href="https://x.com/Arkhampad" target="_blank" rel="noopener noreferrer">@Arkhampad on X</a>
            </div>
            <span style={{ fontSize: 12, color: "var(--faint)" }}>We never message first and never ask for your seed phrase or password.</span>
          </section>
        </div>
      </div>
    </div>
  );
}
