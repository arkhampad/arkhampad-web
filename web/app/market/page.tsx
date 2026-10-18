"use client";
import { Suspense } from "react";
import { SpotScreen } from "@/components/spot";

export default function MarketPage() {
  return (
    <Suspense fallback={<div className="wrap page" />}>
      <SpotScreen />
    </Suspense>
  );
}
