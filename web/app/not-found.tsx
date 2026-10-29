import Link from "next/link";

export default function NotFound() {
  return (
    <main className="e-in e-page">
      <div className="e-panel e-empty" style={{ padding: "60px 20px" }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 28, color: "var(--e-text)" }}>Page not found</h1>
        <p style={{ margin: "0 0 18px" }}>This page doesn&apos;t exist or has moved.</p>
        <Link href="/" className="e-btn pri">Go to Discover</Link>
      </div>
    </main>
  );
}
