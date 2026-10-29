// Renders the small markdown subset used by Learn articles (see lib/learn/types.ts). Server-safe.
import Link from "next/link";
import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${key}b${i++}`}>{m[1]}</strong>);
    else {
      const href = m[3];
      out.push(href.startsWith("/") ? <Link key={`${key}l${i++}`} href={href}>{m[2]}</Link> : <a key={`${key}l${i++}`} href={href} target="_blank" rel="noopener noreferrer">{m[2]}</a>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Md({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <>
      {blocks.map((b, bi) => {
        const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.every((l) => l.startsWith("- "))) return <ul key={bi}>{lines.map((l, i) => <li key={i}>{inline(l.slice(2), `${bi}-${i}`)}</li>)}</ul>;
        if (lines.every((l) => /^\d+\.\s/.test(l))) return <ol key={bi}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\d+\.\s/, ""), `${bi}-${i}`)}</li>)}</ol>;
        // mixed block: paragraph lines, then list lines
        const parts: ReactNode[] = [];
        let list: string[] = [];
        let kind: "ul" | "ol" | null = null;
        const flush = () => {
          if (!list.length) return;
          const items = list.map((l, i) => <li key={i}>{inline(l.replace(/^(-|\d+\.)\s/, ""), `${bi}-m${parts.length}-${i}`)}</li>);
          parts.push(kind === "ol" ? <ol key={`o${parts.length}`}>{items}</ol> : <ul key={`u${parts.length}`}>{items}</ul>);
          list = [];
          kind = null;
        };
        for (const l of lines) {
          if (l.startsWith("- ") || /^\d+\.\s/.test(l)) { kind = kind ?? (l.startsWith("- ") ? "ul" : "ol"); list.push(l); }
          else { flush(); parts.push(<p key={`p${parts.length}`}>{inline(l, `${bi}-p${parts.length}`)}</p>); }
        }
        flush();
        return <div key={bi} className="e-mdblk">{parts}</div>;
      })}
    </>
  );
}
