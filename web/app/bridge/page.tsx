import type { Metadata } from "next";
import { BridgePage } from "@/components/ely/bridge";

export const metadata: Metadata = {
  title: "Bridge HYPE or USDC to Elysium",
  description: "Add HYPE to Elysium through the official bridge, or bring USDC from Base and arrive with HYPE. Deposits land in about a minute.",
  alternates: { canonical: "/bridge/" },
};

export default function Page() {
  return <BridgePage />;
}
