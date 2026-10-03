import Link from "next/link";
export default function NotFound() {
  return (<div className="wrap page" style={{ alignItems: "center", textAlign: "center", paddingTop: 80 }}><h1 className="h-title">Page not found</h1><p className="h-sub">This page doesn&apos;t exist or has moved.</p><Link href="/" className="btn volt">Go to Discover</Link></div>);
}
