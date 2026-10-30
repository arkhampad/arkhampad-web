import { readFileSync } from "node:fs";

// Elysium contract addresses come straight from the deploy record, so the site picks up the router
// as soon as the deploy workflow saves contracts-elysium/deployments/99901.json (env vars still win).
let ely = {};
try {
  ely = JSON.parse(readFileSync(new URL("../contracts-elysium/deployments/99901.json", import.meta.url), "utf8"));
} catch {}
let test = {};
try {
  test = JSON.parse(readFileSync(new URL("../contracts-elysium/deployments/99801.json", import.meta.url), "utf8"));
} catch {}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_ELY_ROUTER: process.env.NEXT_PUBLIC_ELY_ROUTER || ely.arkhamRouter || "",
    NEXT_PUBLIC_ELY_LAUNCHER: process.env.NEXT_PUBLIC_ELY_LAUNCHER || ely.launcher || "",
    NEXT_PUBLIC_ELY_TEST_LAUNCHER: test.launcher || "",
    NEXT_PUBLIC_ELY_TEST_ROUTER: test.arkhamRouter || "",
    NEXT_PUBLIC_ELY_TEST_WHYPE: test.whype || "",
    NEXT_PUBLIC_ELY_TEST_BLOCK: String(test.block || 0),
  },
};
export default nextConfig;
