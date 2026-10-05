import type { Metadata } from "next";
import { LegalPage } from "@/components/legal";
import { terms } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Use", description: "The terms for using ArkhamPad, including risks, fees and your responsibilities.", alternates: { canonical: "/terms/" } };
export default function Page() { return <LegalPage doc={terms} other={{ href: "/privacy/", label: "Privacy Policy" }} />; }
