"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Coin } from "@/lib/types";
import { Avatar, ChainTag, Chg, Spark } from "./bits";
import type { LiveCoin } from "@/lib/live";
import { usd } from "@/lib/live";
import { FeeChip } from "./v2";

const href = (c: Coin) => `/coin/?c=${c.id}`;

/** Compact featured coin card: tap anywhere to open the coin. */
export function HotCard({ c, grad = false }: { c: Coin; grad?: boolean }) {
  const p = Math.max(0, Math.min(100, c.progress));
  return (
    <Link href={href(c)} className="card click-card hc">
      <span className="hc-top">
        <Avatar name={c.name} c1={c.c1} c2={c.c2} size={34} img={c.image} />
        <span className="hc-name"><b>{c.name}</b><span className="mono">{c.tick} · {c.chain} · {c.age}</span></span>
        {grad ? <span className="mono hc-pct">{p.toFixed(0)}%</span> : <Chg n={c.chg} />}
      </span>
      {grad ? (
        <>
          <span className="hc-mid"><span className="mono hc-mc">{c.mc}</span><span className="dim" style={{ fontSize: 11 }}>to graduate</span></span>
          <span className="bar" style={{ height: 6 }}><span style={{ width: `${Math.max(2, p)}%` }} /></span>
        </>
      ) : (
        <span className="hc-mid">
          <span className="mono hc-mc">{c.mc}</span>
          <span className="hc-spark"><Spark vals={c.spark} up={c.chg >= 0} w={120} h={34} height={34} empty={null} /></span>
        </span>
      )}
      <span className="hc-meta"><span>Vol <b className="mono">{c.vol}</b></span><span>{c.own ? "In pool" : "Liq"} <b className="mono">{c.liq}</b></span><span className="hide-m">Trades <b className="mono">{c.trades}</b></span></span>
    </Link>
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
      <table className="tbl" style={{ minWidth: 820 }}>
        <thead><tr><th>#</th><th className="l">COIN</th><th>PRICE</th><th>24H</th><th>MARKET CAP</th><th>VOLUME</th><th>LIQUIDITY</th><th style={{ textAlign: "center" }}>24H</th></tr></thead>
        <tbody>
          {list.map((c, i) => (
            <tr key={c.id} className="click" onClick={() => router.push(href(c))}>
              <td className="dim" style={{ fontSize: 13 }}>{start + i + 1}</td>
              <td className="l" style={{ fontFamily: "var(--sans)" }}>
                <Link href={href(c)} onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Avatar name={c.name} c1={c.c1} c2={c.c2} size={32} img={c.image} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                    <span className="mono dim" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>{c.tick}<ChainTag chain={c.chain} />· {c.age}{c.own && <span className="pill" style={{ padding: "1px 7px", fontSize: 10, background: "rgba(212,255,58,0.12)", color: "var(--volt-ink)" }}>Testnet</span>}</span>
                  </span>
                </Link>
              </td>
              <td className={flash[c.id] ? `flash-${flash[c.id]}` : ""}>{c.price}</td>
              <td><Chg n={c.chg} /></td>
              <td style={{ fontWeight: 700 }}>{c.mc}</td>
              <td style={{ color: "var(--text2)" }}>{c.vol}</td>
              <td style={{ color: "var(--text2)" }}>{c.liq}</td>
              <td style={{ width: 110 }}><Spark vals={c.spark} up={c.chg >= 0} height={28} fill={false} empty={<span className="dim">—</span>} /></td>
              
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Phone list, app-style: name and market cap on the left, price and 24h change on the right. */
export function CoinRows({ list }: { list: Coin[] }) {
  return (
    <div>
      {list.map((c) => (
        <Link key={c.id} href={href(c)} className="lrow arow">
          <span className="arow-av">
            <Avatar name={c.name} c1={c.c1} c2={c.c2} size={40} img={c.image} />
            <i style={{ background: c.chain === "Base" ? "var(--base)" : c.chain === "BNB" ? "var(--bnb)" : c.chain === "Arc" ? "var(--arc)" : "var(--rh)" }} aria-label={c.chain} />
          </span>
          <span className="arow-l">
            <b>{c.tick}</b>
            <span className="mono">{c.mc} MC</span>
          </span>
          <span className="arow-r">
            <b className="mono">{c.price}</b>
            <span className={`mono ${c.chg >= 0 ? "up" : "down"}`}>{c.chg >= 0 ? "▲" : "▼"} {Math.abs(c.chg).toFixed(2)}%</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/** Discover list: ticket cards (picture left, name and price line in the middle, numbers right).
 * Coins launched here show the creator's earnings and their pool fee. */
export function CoinTickets({ list }: { list: LiveCoin[] }) {
  return (
    <div className="tk-grid">
      {list.map((c) => (
        <Link key={c.id} href={href(c)} className="tk">
          <span className="tk-av"><Avatar name={c.name} c1={c.c1} c2={c.c2} size={60} img={c.image} round={false} /></span>
          <span className="tk-mid">
            <span className="tk-name"><b>{c.name}</b>{c.own && <FeeChip c={c} />}</span>
            <span className="tk-meta mono">
              <span>{c.tick}</span><span>·</span><span>{c.age}</span>
              {c.own ? <span className="tk-here">Launched here</span> : <ChainTag chain={c.chain} />}
            </span>
            <span className="tk-spark"><Spark vals={c.spark} up={c.chg >= 0} w={160} h={22} height={22} fill={false} stroke={1.6} empty={<span className="tk-flat" />} /></span>
          </span>
          <span className="tk-r">
            <b className="mono">{c.mc}</b>
            <Chg n={c.chg} />
            <small className="mono">{c.own ? <>Earned {usd(c.creatorFees ?? 0)}</> : c.firstMc && c.mcNum ? (
              // the market cap when ArkhamPad listed (or picked) it, and how far it has gone since
              <span title="Market cap when ArkhamPad listed it">Listed {usd(c.firstMc)} <b style={{ color: c.mcNum >= c.firstMc ? "var(--up)" : "var(--down)" }}>{(c.mcNum / c.firstMc).toFixed(c.mcNum / c.firstMc >= 10 ? 0 : 1)}x</b></span>
            ) : <>Vol {c.vol}</>}</small>
          </span>
        </Link>
      ))}
    </div>
  );
}
