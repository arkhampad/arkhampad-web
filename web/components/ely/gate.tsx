"use client";
// Until the Elysium site opens (NEXT_PUBLIC_ELY_LIVE=1) every page shows "Opening soon", except the
// Learn guides, which are public from day one so search engines can find them early.
import { usePathname } from "next/navigation";
import { ElyShell } from "./shell";
import { Soon } from "@/components/soon";

const LIVE = process.env.NEXT_PUBLIC_ELY_LIVE === "1";

export function Gate({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  if (LIVE || path.startsWith("/learn")) return <ElyShell>{children}</ElyShell>;
  return <Soon />;
}
