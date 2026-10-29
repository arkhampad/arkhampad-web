import type { Metadata } from "next";
import { CreatePage } from "@/components/ely/create";

export const metadata: Metadata = {
  title: "Create a coin on Elysium",
  description: "Launch your own coin on Elysium in about 30 seconds. Liquidity locked forever, and you earn 30% of the trading fees on every buy and sell.",
  alternates: { canonical: "/create/" },
};

export default function Page() {
  return <CreatePage />;
}
