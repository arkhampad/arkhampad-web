// /sitemap.xml: the Elysium site's public pages and every Learn article, built with the site.
import type { MetadataRoute } from "next";
import { LEARN_DATE, POSTS } from "@/lib/learn";

export const dynamic = "force-static";
const SITE = "https://arkhampad.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: [string, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
    ["/", 1, "hourly"], ["/create/", 0.9, "weekly"], ["/bridge/", 0.8, "weekly"], ["/learn/", 0.8, "weekly"],
    ["/terms/", 0.2, "yearly"], ["/privacy/", 0.2, "yearly"],
  ];
  return [
    ...pages.map(([p, priority, changeFrequency]) => ({ url: `${SITE}${p}`, lastModified: now, changeFrequency, priority })),
    ...POSTS.map((p) => ({ url: `${SITE}/learn/${p.slug}/`, lastModified: new Date(LEARN_DATE), changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
