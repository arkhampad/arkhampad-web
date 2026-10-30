import type { Metadata } from "next";
import { TestnetPage } from "@/components/ely/testnet";

export const metadata: Metadata = {
  title: "ArkhamPad testnet",
  description: "Try ArkhamPad on Elysium testnet: launch a coin, buy and sell it with free test HYPE.",
  alternates: { canonical: "/testnet/" },
  robots: { index: false },
};

export default function Page() {
  return <TestnetPage />;
}
