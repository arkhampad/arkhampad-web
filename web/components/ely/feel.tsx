"use client";
// Touch feel for phones: a short haptic tick on taps and page changes, and pull-to-refresh.
// Android uses navigator.vibrate; iPhone (Safari 18+) has no vibrate API, so we toggle a hidden
// system switch, which iOS answers with its own haptic tick.
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

let iosSwitch: HTMLLabelElement | null = null;
export function haptic(strength: "light" | "strong" = "light") {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator && /Android/i.test(navigator.userAgent)) {
      navigator.vibrate(strength === "strong" ? [0, 34] : 22);
      return;
    }
    if (!/iPhone|iPad/i.test(navigator.userAgent)) return;
    if (!iosSwitch) {
      const label = document.createElement("label");
      label.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
      label.setAttribute("aria-hidden", "true");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
      iosSwitch = label;
    }
    iosSwitch.click();
    if (strength === "strong") setTimeout(() => iosSwitch?.click(), 70);
  } catch {}
}

export function Feel() {
  const path = usePathname();
  const first = useRef(true);
  const [pull, setPull] = useState(0);
  const [loading, setLoading] = useState(false);

  // a tick on every page change
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    haptic("light");
  }, [path]);

  // a tick on taps of buttons and links
  useEffect(() => {
    const on = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const el = (e.target as HTMLElement | null)?.closest("button, a, [role=tab], label");
      if (el && !(el as HTMLButtonElement).disabled) haptic(el.classList.contains("e-go") ? "strong" : "light");
    };
    document.addEventListener("pointerdown", on, { passive: true });
    return () => document.removeEventListener("pointerdown", on);
  }, []);

  // pull down from the top of the page to reload
  useEffect(() => {
    let startY = -1;
    let dist = 0;
    const start = (e: TouchEvent) => {
      startY = window.scrollY <= 0 && !document.querySelector(".e-sheet") ? e.touches[0].clientY : -1;
      dist = 0;
    };
    const move = (e: TouchEvent) => {
      if (startY < 0) return;
      dist = Math.max(0, e.touches[0].clientY - startY);
      if (dist > 0 && window.scrollY <= 0) setPull(Math.min(110, dist * 0.55));
    };
    const end = () => {
      if (startY >= 0 && dist * 0.55 >= 70) {
        setLoading(true);
        haptic("strong");
        setTimeout(() => location.reload(), 150);
      } else setPull(0);
      startY = -1;
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
    };
  }, []);

  if (!pull && !loading) return null;
  const ready = pull >= 70 || loading;
  return (
    <div className="e-ptr" style={{ transform: `translate(-50%, ${loading ? 70 : pull}px)`, opacity: Math.min(1, pull / 50) || 1 }} aria-hidden="true">
      <span className={ready ? "e-spin" : ""} style={ready ? undefined : { transform: `rotate(${pull * 4}deg)` }}>{ready ? "" : "↓"}</span>
    </div>
  );
}
