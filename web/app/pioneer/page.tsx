import type { Metadata } from "next";
import { PioneerPage } from "@/components/ely/pioneer";

export const metadata: Metadata = {
  title: "ArkhamPad Pioneer · free mint on Elysium",
  description: "10,000 free on-chain badges for the first people on Elysium. One per wallet, gas only.",
  openGraph: { title: "ArkhamPad Pioneer · free mint on Elysium", description: "10,000 free on-chain badges for the first people on Elysium. One per wallet.", images: ["/pioneer/og.png"] },
  twitter: { card: "summary_large_image", images: ["/pioneer/og.png"] },
};

export default function Page() {
  return <PioneerPage />;
}
