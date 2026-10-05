"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Coin } from "@/lib/types";
import { Avatar, ChainTag, Chg, Spark } from "./bits";
import { IBell } from "./icons";

const href = (c: Coin) => `/coin/?c=${c.id}`;

export function HotCard({ c, grad = false }: { c: Coin; grad?: boolean }) {
  const router = useRouter();
  const p = Math.max(0, Math.min(100, c.progress));
  // heartbeat speeds up as the coin nears graduation
  const beat = p >= 70 ? `${(1.4 - ((p - 70) / 30) * 1.0).toFixed(2)}s` : "0s";
  return (
    <div className="card click-card" style={{ borderRadius: 22, padding: 20, gap: 14, cursor: "pointer" }} onClick={(e) => { if (!(e.target as HTMLElement).closest("button,a")) router.push(href(c)); }}>
      <Link href={href(c)} style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar name={c.name} c1={c.c1} c2={c.c2} size={48} img={c.image} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>{c.name}</span>
          <span className="mono dim" style={{ fontSize: 12 }}>{c.tick} · {c.chain} · {c.age}</span>
        </span>
        <Chg n={c.chg} />
      </Link>
      <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span className="mono hot-mc" style={{ fontWeight: 700, fontSize: 34, letterSpacing: -1 }}>{c.mc}</span><span className="dim" style={{ fontSize: 13 }}>market cap</span></span>
      {grad ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
            <span style={{ fontWeight: 700 }}>Graduation</span>
            <span className="mono volt" style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}>
              {p >= 70 && <span className="beat" aria-hidden="true" style={{ ["--beat" as string]: beat, fontSize: 12 + Math.round(((p - 70) / 30) * 8) }}>🔥</span>}
              {p.toFixed(0)}%
            </span>
          </div>
          <div className="bar" style={{ height: 12, borderRadius: 6 }}><span style={{ width: `${Math.max(2, p)}%` }} /></div>
          <span className="dim" style={{ fontSize: 12 }}>At 100% it moves to a locked pool forever.</span>
        </div>
      ) : <span className="hot-spark"><Spark vals={c.spark} up={c.chg >= 0} w={300} h={90} height="100%" /></span>}
      <span className="grid3" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, fontSize: 12, color: "var(--dim)" }}>
        <span>Vol 24h<br /><b className="mono" style={{ fontSize: 14, color: "var(--text)" }}>{c.vol}</b></span>
        <span>Liquidity<br /><b className="mono" style={{ fontSize: 14, color: "var(--text)" }}>{c.liq}</b></span>
        <span>Trades 24h<br /><b className="mono" style={{ fontSize: 14, color: "var(--text)" }}>{c.trades}</b></span>
      </span>
      <span style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn volt" style={{ flex: 1, height: 46, fontSize: 15 }} onClick={() => router.push(href(c))}>{c.own ? "Buy" : "View"}</button>
        <button type="button" className="icon-btn" aria-label={`Alert for ${c.name}`} style={{ width: 46, height: 46 }} onClick={() => router.push(href(c))}><IBell size={18} color="var(--text2)" /></button>
      </span>
    </div>
  );
}

/** Remembers each coin's last price and returns "up"/"down" for a brief flash when it changes. */
function usePriceFlash(list: Coin[]) {
  const last = useRef(new Map<string, string>());
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  useEffect(() => {
    const next: Record<string, "up" | "down"> = {};
    for (const c of list) {
      const prev = last.current.get(c.id);
      if (prev !== undefined && prev !== c.price) {
        const a = Number(prev.replace(/[^0-9.]/g, "")), b = Number(c.price.replace(/[^0-9.]/g, ""));
        next[c.id] = b >= a ? "up" : "down";
      }
      last.current.set(c.id, c.price);
    }
    if (Object.keys(next).length) {
      setFlash(next);
      const t = setTimeout(() => setFlash({}), 1200);
      return () => clearTimeout(t);
    }
  }, [list]);
  return flash;
}

export function CoinTable({ list, start = 0 }: { list: Coin[]; start?: number }) {
  const router = useRouter();
  const flash = usePriceFlash(list);
  return (
    <div className="tbl-box">
      <table className="tbl" style={{ minWidth: 900 }}>
        <thead><tr><th>#</th><th className="l">COIN</th><th>PRICE</th><th>24H</th><th>MARKET CAP</th><th>VOLUME</th><th>LIQUIDITY</th><th style={{ textAlign: "center" }}>24H CHART</th><th /></tr></thead>
        <tbody>
          {list.map((c, i) => (
            <tr key={c.id} className="click" onClick={() => router.push(href(c))}>
              <td className="dim" style={{ fontSize: 13 }}>{start + i + 1}</td>
              <td className="l" style={{ fontFamily: "var(--sans)" }}>
                <Link href={href(c)} onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Avatar name={c.name} c1={c.c1} c2={c.c2} size={38} img={c.image} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</span>
                    <span className="mono dim" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>{c.tick}<ChainTag chain={c.chain} />· {c.age}{c.own && <span className="pill" style={{ padding: "1px 7px", fontSize: 10, background: "rgba(212,255,58,0.12)", color: "var(--volt-ink)" }}>Testnet</span>}</span>
                  </span>
                </Link>
              </td>
              <td className={flash[c.id] ? `flash-${flash[c.id]}` : ""}>{c.price}</td>
              <td><Chg n={c.chg} /></td>
              <td style={{ fontWeight: 700, fontSize: 15 }}>{c.mc}</td>
              <td style={{ color: "var(--text2)" }}>{c.vol}</td>
              <td style={{ color: "var(--text2)" }}>{c.liq}</td>
              <td style={{ width: 120 }}><Spark vals={c.spark} up={c.chg >= 0} height={34} /></td>
              <td><button type="button" className="btn volt sm" onClick={(e) => { e.stopPropagation(); router.push(href(c)); }}>{c.own ? "Buy" : "View"}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CoinRows({ list }: { list: Coin[] }) {
  return (
    <div>
      {list.map((c) => (
        <Link key={c.id} href={href(c)} className="lrow">
          <Avatar name={c.name} c1={c.c1} c2={c.c2} size={42} img={c.image} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
            <span className="mono dim" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}><span className="dot" style={{ width: 6, height: 6, background: c.chain === "Base" ? "var(--base)" : c.chain === "BNB" ? "var(--bnb)" : c.chain === "Arc" ? "var(--arc)" : "var(--rh)" }} />{c.tick} · {c.age}</span>
          </span>
          <span style={{ width: 58 }}><Spark vals={c.spark} up={c.chg >= 0} height={26} fill={false} stroke={2.4} /></span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, minWidth: 80 }}>
            <span className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{c.mc}</span>
            <span className={`mono ${c.chg >= 0 ? "up" : "down"}`} style={{ fontWeight: 700, fontSize: 12 }}>{c.chg >= 0 ? "+" : ""}{c.chg.toFixed(1)}%</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
