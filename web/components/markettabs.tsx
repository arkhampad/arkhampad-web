"use client";

/** Market's sections: Spot, Futures, Data. One bar on top of each, same place on every screen. */
import Link from "next/link";

const TABS = [
  { id: "spot", href: "/market/", label: "Spot" },
  { id: "futures", href: "/futures/", label: "Futures" },
  { id: "data", href: "/data/", label: "Data" },
] as const;

export function MarketTabs({ at }: { at: (typeof TABS)[number]["id"] }) {
  return (
    <nav className="mkt-tabs" aria-label="Market">
      {TABS.map((t) => (
        <Link key={t.id} href={t.href} className={at === t.id ? "on" : ""} aria-current={at === t.id ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
