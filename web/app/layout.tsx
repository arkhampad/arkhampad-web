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
  icons: { icon: "/favicon.svg", apple: "/icon-192.png" },
  openGraph: { type: "website", siteName: "ArkhamPad", title: "ArkhamPad · Create and trade with intelligence", description: "Create a coin with AI in seconds. Trade with USDC on Robinhood Chain and Base." },
  twitter: { card: "summary_large_image" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0A0B10" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
