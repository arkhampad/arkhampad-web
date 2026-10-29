import type { Metadata } from "next";
import { StatsPage } from "@/components/ely/stats";

export const metadata: Metadata = {
  title: "Elysium stats: volume, trades, tokens",
  description: "Live Elysium network stats: daily trading volume, trades, traders, new tokens and the top tokens of the week, plus ArkhamPad launch numbers.",
  alternates: { canonical: "/stats/" },
};

export default function Page() {
  return <StatsPage />;
}
