"use client";
import { useEffect, useState } from "react";
import { useGraduations } from "@/lib/live";

const COLORS = ["#D4FF3A", "#5CFFB0", "#3DDC97", "#FFB43C", "#7C5CFF", "#2BB3FF", "#FF6B6B"];

/** Small confetti burst and a toast when one of our coins graduates. */
export function Celebrate({ toast }: { toast: (m: string) => void }) {
  const [burst, setBurst] = useState(0);
  useGraduations((c) => {
    toast(`$${c.symbol} just graduated`);
    setBurst((n) => n + 1);
    setTimeout(() => setBurst(0), 3200);
  });
  if (!burst) return null;
  return (
    <div className="confetti" aria-hidden="true" key={burst}>
      {Array.from({ length: 70 }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, background: COLORS[i % COLORS.length], ["--x" as string]: `${((i * 53) % 200) - 100}px`, ["--r" as string]: `${360 + ((i * 97) % 720)}deg`, ["--d" as string]: `${2 + ((i * 13) % 12) / 10}s`, animationDelay: `${(i % 10) * 0.04}s` }} />
      ))}
    </div>
  );
}

/** One confetti burst when it mounts (e.g. right after launching a coin). Respects reduced motion. */
export function Confetti() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setOn(false); return; }
    const t = setTimeout(() => setOn(false), 3400);
    return () => clearTimeout(t);
  }, []);
  if (!on) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 90 }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, background: COLORS[i % COLORS.length], ["--x" as string]: `${((i * 53) % 220) - 110}px`, ["--r" as string]: `${360 + ((i * 97) % 720)}deg`, ["--d" as string]: `${1.8 + ((i * 13) % 14) / 10}s`, animationDelay: `${(i % 12) * 0.03}s` }} />
      ))}
    </div>
  );
}

/** Firework pops from the middle of the screen (two waves), for a new coin going live. */
export function Burst() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setOn(false); return; }
    const t = setTimeout(() => setOn(false), 2600);
    return () => clearTimeout(t);
  }, []);
  if (!on) return null;
  const wave = (n: number, dist: number, delay: number, k: string) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const d = dist * (0.75 + ((i * 7) % 5) / 10);
      return <i key={`${k}${i}`} style={{ background: COLORS[i % COLORS.length], ["--bx" as string]: `${Math.cos(a) * d}px`, ["--by" as string]: `${Math.sin(a) * d}px`, animationDelay: `${delay}s` }} />;
    });
  return (
    <div className="e-burst" aria-hidden="true">
      <b />
      <b style={{ animationDelay: ".45s" }} />
      {wave(28, 170, 0, "a")}
      {wave(22, 120, 0.45, "b")}
    </div>
  );
}
