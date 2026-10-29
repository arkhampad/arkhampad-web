import type { Metadata } from "next";
import { YouPage } from "@/components/ely/you";

export const metadata: Metadata = { title: "You", robots: { index: false } };

export default function Page() {
  return <YouPage />;
}
