import type { Metadata } from "next";
import { PioneerPage } from "@/components/ely/pioneer";

export const metadata: Metadata = {
  title: "ArkhamPad Genesis · free mint on Elysium",
  description: "The first ArkhamPad collection: 10,000 free on-chain badges for the first people on Elysium. One per wallet, gas only.",
  openGraph: { title: "ArkhamPad Genesis · free mint on Elysium", description: "The first ArkhamPad collection: 10,000 free on-chain badges for the first people on Elysium. One per wallet.", images: ["/genesis/og.png"] },
  twitter: { card: "summary_large_image", images: ["/genesis/og.png"] },
};

export default function Page() {
  return <PioneerPage />;
}
