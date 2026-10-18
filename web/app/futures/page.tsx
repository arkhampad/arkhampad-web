"use client";
import { Suspense } from "react";
import { FuturesScreen } from "@/components/futures";

export default function FuturesPage() {
  return (
    <Suspense fallback={<div className="wrap page" />}>
      <FuturesScreen />
    </Suspense>
  );
}
