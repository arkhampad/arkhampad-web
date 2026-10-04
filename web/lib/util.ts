export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
export const initials = (name: string) => {
  const p = name.replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/);
  return (p.length > 1 ? p[0][0] + p[1][0] : (p[0] || "?").slice(0, 2)).toUpperCase();
};
export function sparkPath(vals: number[], w: number, h: number, pad = 3) {
  if (vals.length < 2) vals = vals.length ? [vals[0], vals[0]] : [0, 0];
  const lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1;
  const pts = vals.map((v, i) => [ (i * w) / (vals.length - 1), h - pad - ((v - lo) / r) * (h - pad * 2) ]);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `M0,${h} L` + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L") + ` L${w},${h} Z`;
  return { line, area };
}
