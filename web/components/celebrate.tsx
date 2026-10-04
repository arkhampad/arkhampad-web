"use client";
import { useState } from "react";
import { useGraduations } from "@/lib/live";

const COLORS = ["#D4FF3A", "#5CFFB0", "#3DDC97", "#FFB43C", "#7C5CFF", "#2BB3FF", "#FF6B6B"];

/** Small confetti burst and a toast when one of our coins graduates. */
export function Celebrate({ toast }: { toast: (m: string) => void }) {
  const [burst, setBurst] = useState(0);
  useGraduations((c) => {
    toast(`🎓 $${c.symbol} just graduated!`);
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
