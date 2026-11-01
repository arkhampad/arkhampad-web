"use client";
import { Suspense } from "react";
import { RadarView } from "@/components/ely/radar";

export default function Page() {
  return (
    <Suspense>
      <RadarView />
    </Suspense>
  );
}
