"use client";
// Holder trend without extra database work: each browser remembers a coin's holder count and compares it
// with the number it saw earlier (a snapshot at least 10 minutes old, refreshed about hourly). Rising → green,
// falling → red. Until a coin has been seen twice there is nothing to compare, so it stays neutral.
import { useEffect, useRef, useState } from "react";

type Snap = { h: number; at: number };
type Rec = { base: Snap; prev?: Snap };
const KEY = "ely.holders.v1";
const HOUR = 3_600_000, MIN10 = 600_000;
let mem: Record<string, Rec> | null = null;

function load(): Record<string, Rec> {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { mem = {}; }
  return mem!;
}
function save() { try { const m = load(); const k = Object.keys(m); if (k.length > 400) k.slice(0, k.length - 400).forEach((x) => delete m[x]); localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage blocked: fine */ } }

/** Change in holders since the earlier snapshot (0 when unknown). */
export function holderDelta(addr: string, now: number): number {
  const m = load(), k = addr.toLowerCase(), t = Date.now();
  const r = m[k];
  if (!r) { m[k] = { base: { h: now, at: t } }; save(); return 0; }
  if (t - r.base.at >= HOUR) { r.prev = r.base; r.base = { h: now, at: t }; save(); }
  const ref = t - r.base.at >= MIN10 ? r.base : r.prev ?? r.base;
  return now - ref.h;
}

/** [delta, flash]: delta since the earlier snapshot; flash is "up"/"down" for 1.6s when the count just changed. */
export function useHolderTrend(addr: string, holders: number): [number, "" | "up" | "down"] {
  const [d, setD] = useState(0);
  const [fl, setFl] = useState<"" | "up" | "down">("");
  const last = useRef<number | null>(null);
  useEffect(() => {
    setD(holderDelta(addr, holders));
    if (last.current != null && last.current !== holders) {
      setFl(holders > last.current ? "up" : "down");
      const id = setTimeout(() => setFl(""), 1600);
      last.current = holders;
      return () => clearTimeout(id);
    }
    last.current = holders;
  }, [addr, holders]);
  return [d, fl];
}

/** Flash class when a number moves between polls. */
export function useFlash(v: number | null | undefined): "" | "up" | "down" {
  const [fl, setFl] = useState<"" | "up" | "down">("");
  const last = useRef(v);
  useEffect(() => {
    const p = last.current;
    last.current = v;
    if (p == null || v == null || p === v) return;
    setFl(v > p ? "up" : "down");
    const id = setTimeout(() => setFl(""), 1400);
    return () => clearTimeout(id);
  }, [v]);
  return fl;
}
