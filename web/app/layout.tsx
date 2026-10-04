import type { Metadata, Viewport } from "next";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-sans/800.css";
import "@fontsource/geist-sans/900.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/geist-mono/700.css";
import "@fontsource/geist-mono/800.css";
import "./globals.css";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  metadataBase: new URL("https://arkhampad.com"),
  title: { default: "ArkhamPad · Create and trade with intelligence", template: "%s · ArkhamPad" },
  description: "Describe a coin in any language and AI creates it in seconds. Deposit USDC and trade thousands of coins on Robinhood Chain and Base with one tap.",
  applicationName: "ArkhamPad",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/apple-touch-icon.png" },
  openGraph: { type: "website", siteName: "ArkhamPad", title: "ArkhamPad · Create and trade with intelligence", description: "Create a coin with AI in seconds. Trade with USDC on Robinhood Chain and Base.", url: "https://arkhampad.com", images: [{ url: "/og.png", width: 1200, height: 630, alt: "ArkhamPad · Create and trade with intelligence" }] },
  twitter: { card: "summary_large_image", site: "@Arkhampad", title: "ArkhamPad · Create and trade with intelligence", description: "Create a coin with AI in seconds. Trade with USDC on Robinhood Chain and Base.", images: ["/og.png"] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0A0B10" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
