import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./ely.css";
import { Gate } from "@/components/ely/gate";


export const metadata: Metadata = {
  metadataBase: new URL("https://arkhampad.com"),
  title: { default: "ArkhamPad · Elysium's launchpad", template: "%s · ArkhamPad" },
  description: "The Elysium launchpad. Launch a coin in seconds and trade every Elysium token in one place, with HYPE or USDC.",
  applicationName: "ArkhamPad",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/apple-touch-icon.png" },
  openGraph: { type: "website", siteName: "ArkhamPad", title: "ArkhamPad · Elysium's launchpad", description: "Launch, trade, repeat. Every Elysium token in one place.", url: "https://arkhampad.com", images: [{ url: "/og-v2.png", width: 1200, height: 630, alt: "ArkhamPad · Elysium's launchpad" }] },
  twitter: { card: "summary_large_image", site: "@Arkhampad", title: "ArkhamPad · Elysium's launchpad", description: "Launch, trade, repeat. Every Elysium token in one place.", images: ["/og-v2.png"] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        {/* Light mode unless the visitor chose dark; pages open at the top (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('ap_theme');document.documentElement.dataset.theme=(t==='dark')?'dark':'light';if('scrollRestoration' in history)history.scrollRestoration='manual';}catch(e){document.documentElement.dataset.theme='light';}" }} />
      </head>
      <body><Gate>{children}</Gate></body>
    </html>
  );
}
