"use client";
// Which pages exist. Until the Elysium site opens (NEXT_PUBLIC_ELY_LIVE=1) every page shows "Opening
// soon", except the Learn guides, which are public from day one so search engines find them early.
// Once open, only the Elysium pages are shown; any old address (markets, futures, terminal, old coin
// pages...) goes to Discover.
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ElyShell } from "./shell";
import { Soon } from "@/components/soon";

const LIVE = process.env.NEXT_PUBLIC_ELY_LIVE === "1";
const PAGES = ["/t", "/create", "/bridge", "/you", "/learn", "/terms", "/privacy"];
const known = (p: string) => p === "/" || PAGES.some((x) => p === x || p.startsWith(`${x}/`));

function Away() {
  const r = useRouter();
  useEffect(() => { r.replace("/"); }, [r]);
  return null;
}

export function Gate({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  if (path.startsWith("/learn")) return <ElyShell>{children}</ElyShell>;
  if (!LIVE) return <Soon />;
  if (!known(path)) return <ElyShell><Away /></ElyShell>;
  return <ElyShell>{children}</ElyShell>;
}
