"use client";
import { Suspense } from "react";
import { FuturesScreen } from "@/components/futures";

export default function StocksPage() {
  return (
    <Suspense fallback={<div className="wrap page" />}>
      <FuturesScreen venue="stocks" />
    </Suspense>
  );
}
