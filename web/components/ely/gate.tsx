"use client";
// Which pages exist. Until the Elysium site opens (NEXT_PUBLIC_ELY_LIVE=1) every page shows "Opening
// soon", except the Learn guides, which are public from day one so search engines find them early.
// Once open, only the Elysium pages are shown; any old address (markets, futures, terminal, old coin
// pages...) goes to Discover.
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ElyShell } from "./shell";
import { Soon } from "@/components/soon";

const LIVE = process.env.NEXT_PUBLIC_ELY_LIVE === "1";
const PAGES = ["/ops", "/testnet", "/t", "/create", "/bridge", "/you", "/stats", "/learn", "/terms", "/privacy"];
const known = (p: string) => p === "/" || PAGES.some((x) => p === x || p.startsWith(`${x}/`));

function Away() {
  const r = useRouter();
  useEffect(() => { r.replace("/"); }, [r]);
  return null;
}

/** Team preview before opening: visit /?preview=on once (and /?preview=off to stop), only in that browser. */
function usePreview() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      const q = new URLSearchParams(location.search).get("preview");
      if (q === "on") localStorage.setItem("ap_preview", "1");
      if (q === "off") localStorage.removeItem("ap_preview");
      setOn(localStorage.getItem("ap_preview") === "1");
    } catch {}
  }, []);
  return on;
}

export function Gate({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const preview = usePreview();
  // Learn guides and the testnet page are public before the site opens
  if (path.startsWith("/learn") || path.startsWith("/testnet")) return <ElyShell>{children}</ElyShell>;
  if (!LIVE && !preview) return <Soon />;
  if (!known(path)) return <ElyShell><Away /></ElyShell>;
  return <ElyShell>{children}</ElyShell>;
}
