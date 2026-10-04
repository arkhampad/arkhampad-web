"use client";
// Small, dependency-free bar chart for daily numbers.
export function Bars({ vals, labels, color = "var(--volt)", height = 180, fmt = (v: number) => String(v) }: { vals: number[]; labels: string[]; color?: string; height?: number; fmt?: (v: number) => string }) {
  const max = Math.max(1, ...vals);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height }} role="img" aria-label="Daily chart">
        {vals.map((v, i) => (
          <div key={i} title={`${labels[i]}: ${fmt(v)}`} style={{ flex: 1, minWidth: 2, height: `${Math.max(v > 0 ? 3 : 1, (v / max) * 100)}%`, background: v > 0 ? color : "var(--line2)", borderRadius: "4px 4px 1px 1px", opacity: i === vals.length - 1 ? 1 : 0.8 }} />
        ))}
      </div>
      <div className="mono dim" style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}><span>{labels[0]}</span><span>{labels[labels.length - 1]}</span></div>
    </div>
  );
}
