"use client";
import { Suspense } from "react";
import { PredictScreen } from "@/components/predict";

export default function PredictPage() {
  return (
    <Suspense fallback={<div className="wrap page" />}>
      <PredictScreen />
    </Suspense>
  );
}
