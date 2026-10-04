"use client";
import { initials, sparkPath } from "@/lib/util";
import { useId, useState } from "react";
import type { Chain } from "@/lib/mock";

export function Avatar({ name, c1, c2, size = 40, round = false, img }: { name: string; c1: string; c2: string; size?: number; round?: boolean; img?: string | null }) {
  const [broken, setBroken] = useState(false);
  const radius = round ? "50%" : Math.round(size * 0.3);
  if (img && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={img} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", flex: "none", background: "var(--raise)" }} />;
  }
  return (
    <span className="av" style={{ width: size, height: size, borderRadius: radius, background: `linear-gradient(135deg, ${c1}, ${c2})`, fontSize: Math.round(size * 0.34) }}>
      {initials(name)}
    </span>
  );
}

export function Spark({ vals, up, w = 120, h = 40, height, fill = true, stroke = 2 }: { vals: number[]; up: boolean; w?: number; h?: number; height?: number | string; fill?: boolean; stroke?: number }) {
  const id = useId().replace(/:/g, "");
  const { line, area } = sparkPath(vals, w, h);
  const col = up ? "var(--up)" : "var(--down)";
  return (
    <svg width="100%" height={height ?? h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" fill="none" aria-hidden="true">
      {fill && (<defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={up ? "#3DDC97" : "#FF6B6B"} stopOpacity="0.3" /><stop offset="1" stopColor={up ? "#3DDC97" : "#FF6B6B"} stopOpacity="0" /></linearGradient></defs>)}
      {fill && <path d={area} fill={`url(#${id})`} />}
      <polyline points={line} stroke={col} strokeWidth={stroke} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ChainTag({ chain }: { chain: Chain }) {
  return (<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span className="dot" style={{ background: chain === "Base" ? "var(--base)" : "var(--rh)" }} />{chain}</span>);
}

export function Chg({ n }: { n: number }) {
  return <span className={`chg ${n >= 0 ? "u" : "d"}`}>{n >= 0 ? "+" : ""}{n.toFixed(1)}%</span>;
}

export function Bar({ pct }: { pct: number }) {
  return <div className="bar"><span style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>;
}

export function FrogArt({ c1 = "#1B1F6B", c2 = "#7C5CFF" }: { c1?: string; c2?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={c1} /><stop offset="1" stopColor={c2} /></linearGradient></defs>
      <rect width="100" height="100" fill={`url(#${id})`} />
      <circle cx="50" cy="60" r="26" fill="#7EE07A" /><circle cx="38" cy="38" r="11" fill="#7EE07A" /><circle cx="62" cy="38" r="11" fill="#7EE07A" />
      <circle cx="38" cy="38" r="5" fill="#0A0B10" /><circle cx="62" cy="38" r="5" fill="#0A0B10" />
      <path d="M38 66 Q50 74 62 66" stroke="#0A0B10" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="50" cy="58" r="34" fill="none" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="2" />
    </svg>
  );
}

/** ArkhamPad mark: chrome A with an orbit ring. */
export function BrandMark({ size = 32, tile = true }: { size?: number; tile?: boolean }) {
  const id = useId().replace(/:/g, "");
  const svg = (
    <svg width={tile ? Math.round(size * 0.82) : size} height={tile ? Math.round(size * 0.82) : size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}c`} x1="0.1" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#FFFFFF" /><stop offset="0.28" stopColor="#DCE1EA" /><stop offset="0.5" stopColor="#8790A3" /><stop offset="0.68" stopColor="#F5F7FB" /><stop offset="1" stopColor="#5D6577" />
        </linearGradient>
        <linearGradient id={`${id}o`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5CFFB0" stopOpacity="0.2" /><stop offset="0.6" stopColor="#D4FF3A" /><stop offset="1" stopColor="#D4FF3A" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="60" rx="44" ry="13" fill="none" stroke={`url(#${id}o)`} strokeWidth="4" transform="rotate(-14 50 60)" opacity="0.55" />
      <path d="M50 8 L86 90 L68 90 L50 46 L32 90 L14 90 Z" fill={`url(#${id}c)`} />
      <path d="M8 66 Q50 82 92 54" fill="none" stroke={`url(#${id}o)`} strokeWidth="4" strokeLinecap="round" transform="rotate(-4 50 60)" />
      <circle cx="90" cy="52" r="4.5" fill="#D4FF3A" />
    </svg>
  );
  if (!tile) return svg;
  return (
    <span style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), background: "radial-gradient(circle at 30% 20%, #232838, #05060A 72%)", border: "1px solid var(--line2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{svg}</span>
  );
}
