import type { Metadata } from "next";
import { LegalPage } from "@/components/legal";
import { privacy } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy", description: "What information ArkhamPad collects, why, who we share it with and your choices.", alternates: { canonical: "/privacy/" } };
export default function Page() { return <LegalPage doc={privacy} other={{ href: "/terms/", label: "Terms of Use" }} />; }
