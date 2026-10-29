import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Soon } from "@/components/soon";

export const metadata: Metadata = {
  metadataBase: new URL("https://arkhampad.com"),
  title: { default: "ArkhamPad · Elysium launchpad", template: "%s · ArkhamPad" },
  description: "The Elysium launchpad. Launch a coin in seconds and trade every Elysium token in one place, with HYPE or USDC.",
  applicationName: "ArkhamPad",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/apple-touch-icon.png" },
  openGraph: { type: "website", siteName: "ArkhamPad", title: "ArkhamPad · Elysium launchpad", description: "Launch, trade, repeat. Every Elysium token in one place.", url: "https://arkhampad.com", images: [{ url: "/og.png", width: 1200, height: 630, alt: "ArkhamPad · Elysium launchpad" }] },
  twitter: { card: "summary_large_image", site: "@Arkhampad", title: "ArkhamPad · Elysium launchpad", description: "Launch, trade, repeat. Every Elysium token in one place.", images: ["/og.png"] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0A0B0D" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Dark mode unless the visitor chose light; pages open at the top (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('ap_theme');document.documentElement.dataset.theme=(t==='light')?'light':'dark';if('scrollRestoration' in history)history.scrollRestoration='manual';}catch(e){document.documentElement.dataset.theme='dark';}" }} />
      </head>
      <body><Soon /></body>
    </html>
  );
}
