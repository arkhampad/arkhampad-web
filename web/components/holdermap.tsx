"use client";
// Holder map: bubbles sized by share, linked wallets grouped and coloured, plus a holder table.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ago, short, useLive, type LiveCoin } from "@/lib/live";
import { layout, loadHolderMap, type Holder } from "@/lib/holders";

const W = 640, H = 520;
const usd = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(n >= 100 ? 0 : 2)}`);

export function HolderMap({ c, stacked = false }: { c: LiveCoin; stacked?: boolean }) {
  const q = useLive(() => loadHolderMap(c), [c.id], 30_000);
  const m = q.data;
  const nodes = useMemo(() => (m ? layout(m, W, H) : []), [m]);
  const pos = useMemo(() => new Map(nodes.map((n) => [n.h.w, n])), [nodes]);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<{ h: Holder; x: number; y: number } | null>(null);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const [all, setAll] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setSel(null); setView({ z: 1, x: 0, y: 0 }); }, [c.id]);

  if (m === null) return <div className="skel" style={{ height: 420, borderRadius: 12 }} />;
  if (!m || m.holders.length === 0) return <div className="card" style={{ fontSize: 13 }}><b>Holders</b><span className="dim">No holders yet. The map appears after the first buys.</span></div>;

  const pool = nodes.find((n) => n.h.group === "pool");
  const biggest = m.clusters.filter((x) => x.group !== "creator").sort((a, b) => b.pct - a.pct)[0];
  const creatorGroup = m.clusters.find((x) => x.group === "creator");
  const alert = biggest && biggest.pct >= 5
    ? `${biggest.size} ${biggest.group === "linked" ? "wallets linked by transfers" : "wallets that bought in the same block"} hold ${biggest.pct.toFixed(1)}% of supply.`
    : m.clusters.length === 0 ? "No linked wallets among the top holders." : null;
  const rows = all ? m.holders : m.holders.slice(0, 20);
  const zoom = (f: number) => setView((v) => ({ ...v, z: Math.max(0.7, Math.min(3, v.z * f)) }));

  return (
    <div className="hm">
      <div className="hm-stats">
        <span><i>Holders</i><b className="mono">{m.total.toLocaleString("en-US")}</b></span>
        <span><i>Clusters</i><b className="mono">{m.clusters.filter((x) => x.size > 1).length}</b></span>
        <span><i>Largest cluster</i><b className="mono">{biggest ? `${biggest.pct.toFixed(1)}%` : "—"}</b></span>
        <span><i>Creator group</i><b className="mono">{creatorGroup ? `${creatorGroup.pct.toFixed(1)}%` : "—"}</b></span>
        <span><i>First-minute buyers</i><b className="mono">{m.earlyBuyers}</b></span>
      </div>
      {alert && <div className="hm-alert"><i style={{ background: biggest && biggest.pct >= 5 ? "var(--warn)" : "var(--up)" }} />{alert}</div>}
      <div className={`hm-grid${stacked ? " stacked" : ""}`}>
        <div className="hm-map" ref={box}
          onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.1 : 0.9); } }}
          onPointerDown={(e) => { if ((e.target as Element).closest("[data-w]")) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; }}
          onPointerMove={(e) => { if (!drag.current || !box.current) return; const s = W / box.current.clientWidth; setView((v) => ({ ...v, x: drag.current!.vx + (e.clientX - drag.current!.x) * s, y: drag.current!.vy + (e.clientY - drag.current!.y) * s })); }}
          onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; setHover(null); }}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Holder map: bubbles are holders, size is their share">
            <g transform={`translate(${W / 2 + view.x} ${H / 2 + view.y}) scale(${view.z}) translate(${-W / 2} ${-H / 2})`}>
              {pool && nodes.map((n) => n.h.group === "pool" ? null : <line key={`f${n.h.w}`} x1={pool.x} y1={pool.y} x2={n.x} y2={n.y} className="hm-flow" />)}
              {m.links.map((l) => { const a = pos.get(l.a), b = pos.get(l.b); if (!a || !b) return null; const col = a.h.color && a.h.cluster === b.h.cluster ? a.h.color : undefined; return <line key={`${l.a}${l.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="hm-link" style={col ? { stroke: col, strokeOpacity: 0.7 } : undefined} />; })}
              {nodes.map((n) => {
                const on = sel === n.h.w;
                return (
                  <g key={n.h.w} data-w={n.h.w} className="hm-node" onClick={() => setSel(on ? null : n.h.w)}
                    onPointerEnter={(e) => { const r = box.current?.getBoundingClientRect(); if (r && e.pointerType === "mouse") setHover({ h: n.h, x: e.clientX - r.left, y: e.clientY - r.top }); }}
                    onPointerLeave={() => setHover(null)}>
                    <circle cx={n.x} cy={n.y} r={n.r} className={n.h.color ? "" : "hm-solo"} style={n.h.color ? { fill: n.h.color, stroke: n.h.color, fillOpacity: n.h.group === "pool" ? 1 : 0.85 } : undefined} strokeWidth={on ? 3 : 1.2} />
                    {on && <circle cx={n.x} cy={n.y} r={n.r + 4} className="hm-ring" />}
                    {n.h.group === "pool" && n.r > 16 && <text x={n.x} y={n.y + 4} textAnchor="middle" className="hm-pool-t">{n.h.label === "DEX pool" ? "DEX" : "POOL"}</text>}
                    {n.h.group !== "pool" && n.r >= 13 && <text x={n.x} y={n.y + 3.5} textAnchor="middle" className="hm-pct">{n.h.pct.toFixed(1)}%</text>}
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="hm-legend">
            <span><i style={{ background: "#F59E0B" }} />Creator group</span>
            <span><i style={{ background: "#F6465D" }} />Linked wallets</span>
            <span><i style={{ background: "#3B82F6" }} />Pool</span>
            <span><i className="hm-solo-dot" />Independent</span>
          </div>
          <div className="hm-tools">
            <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)}>+</button>
            <button type="button" aria-label="Zoom out" onClick={() => zoom(0.8)}>−</button>
            <button type="button" aria-label="Reset view" onClick={() => setView({ z: 1, x: 0, y: 0 })}>⤢</button>
          </div>
          {hover && (
            <div className="hm-tip" style={{ left: Math.min(hover.x + 14, (box.current?.clientWidth ?? 300) - 200), top: hover.y + 14 }}>
              <b className="mono">{hover.h.group === "pool" ? hover.h.label : short(hover.h.w)}</b>
              {hover.h.label && hover.h.group !== "pool" && <span><i>Label</i>{hover.h.label}</span>}
              <span><i>Share</i><b className="mono">{hover.h.pct.toFixed(2)}%</b></span>
              {hover.h.group !== "pool" && <span><i>First buy</i>{hover.h.firstTs ? ago(hover.h.firstTs) : "—"}</span>}
            </div>
          )}
        </div>

        <div className="hm-table">
          <table className="tbl">
            <thead><tr><th>#</th><th>Wallet</th><th>Label</th><th>Share</th><th className="hide-m">Bought</th><th className="hide-m">Sold</th><th className="hide-m">First buy</th></tr></thead>
            <tbody>
              {rows.map((h, i) => (
                <tr key={h.w} className={sel === h.w ? "hl" : ""} onClick={() => setSel(sel === h.w ? null : h.w)}>
                  <td className="dim mono">{i + 1}</td>
                  <td className="mono">{h.group === "pool" ? h.label : <Link href={`/trader/?a=${h.w}`} onClick={(e) => e.stopPropagation()}>{short(h.w)}</Link>}</td>
                  <td>{h.label && h.group !== "pool" ? <span className="hm-tag" title={h.label}><i style={{ background: h.color ?? "var(--line3)" }} /><span>{h.label}</span></span> : null}</td>
                  <td><span className="hm-share"><span className="mono">{h.pct.toFixed(2)}%</span><span className="hm-bar"><span style={{ width: `${Math.min(100, h.pct * 8)}%` }} /></span></span></td>
                  <td className="mono hide-m">{h.bought ? usd(h.bought) : "—"}</td>
                  <td className="mono hide-m">{h.sold ? usd(h.sold) : "—"}</td>
                  <td className="mono dim hide-m">{h.firstTs ? ago(h.firstTs) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {m.holders.length > 20 && <button type="button" className="btn ghost sm" style={{ margin: 10 }} onClick={() => setAll(!all)}>{all ? "Show top 20" : `Show all ${m.holders.length}`}</button>}
          {!m.fromTransfers && <p className="dim" style={{ fontSize: 11, margin: "8px 12px" }}>Links between wallets appear once transfer history for this coin finishes loading.</p>}
        </div>
      </div>
    </div>
  );
}
