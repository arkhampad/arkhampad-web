// /sitemap.xml: every public page and Learn article, built with the site.
// Coin pages change all the time, so they live in /sitemap-coins.xml (a Pages Function).
import type { MetadataRoute } from "next";
import { guides } from "@/lib/guides";

export const dynamic = "force-static";
const SITE = "https://arkhampad.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: [string, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
    ["/", 1, "hourly"], ["/terminal/", 0.8, "hourly"], ["/create/", 0.9, "weekly"], ["/traders/", 0.7, "daily"],
    ["/analytics/", 0.6, "daily"], ["/daily/", 0.6, "daily"], ["/learn/", 0.8, "weekly"], ["/help/", 0.7, "weekly"],
    ["/invite/", 0.4, "monthly"], ["/terms/", 0.2, "yearly"], ["/privacy/", 0.2, "yearly"],
    ["/security/", 0.5, "monthly"], ["/market/", 0.8, "hourly"], ["/futures/", 0.8, "hourly"], ["/data/", 0.7, "hourly"],
  ];
  return [
    ...pages.map(([p, priority, changeFrequency]) => ({ url: `${SITE}${p}`, lastModified: now, changeFrequency, priority })),
    ...guides.map((g) => ({ url: `${SITE}/learn/${g.slug}/`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
