import type { Metadata } from "next";
import { OpsPage } from "@/components/ely/ops";

export const metadata: Metadata = { title: "Ops", robots: { index: false, follow: false } };

export default function Page() {
  return <OpsPage />;
}
