"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** A row of chips/tabs that scrolls sideways: arrows on desktop, swipe on phones, faded edges. */
export function ScrollTabs({ children, gap = 8 }: { children: React.ReactNode; gap?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);
  const check = useCallback(() => {
    const el = box.current;
    if (!el) return;
    setLeft(el.scrollLeft > 4);
    setRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    // A mouse wheel scrolls the row sideways while the pointer is over it.
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) { el.scrollLeft += e.deltaY; e.preventDefault(); }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("wheel", wheel); };
  }, [check]);
  const nudge = (d: number) => box.current?.scrollBy({ left: d * Math.max(160, (box.current?.clientWidth ?? 300) * 0.7), behavior: "smooth" });
  const mask = `linear-gradient(90deg, ${left ? "transparent 0, #000 36px" : "#000 0"}, ${right ? "#000 calc(100% - 36px), transparent 100%" : "#000 100%"})`;
  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <div ref={box} onScroll={check} className="hscroll" style={{ gap, WebkitMaskImage: mask, maskImage: mask, scrollSnapType: "x proximity" }}>{children}</div>
      {left && <button type="button" aria-label="Scroll left" className="st-arrow hide-m" style={{ left: -4 }} onClick={() => nudge(-1)}>‹</button>}
      {right && <button type="button" aria-label="Scroll right" className="st-arrow hide-m" style={{ right: -4 }} onClick={() => nudge(1)}>›</button>}
    </div>
  );
}
