"use client";
import { Suspense } from "react";
import { ArenaScreen } from "@/components/arena";

export default function ArenaPage() {
  return (
    <Suspense fallback={<div className="wrap page" />}>
      <ArenaScreen />
    </Suspense>
  );
}
