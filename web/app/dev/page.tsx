"use client";
import { Suspense } from "react";
import { DevView } from "@/components/ely/dev";

export default function Page() {
  return (
    <Suspense>
      <DevView />
    </Suspense>
  );
}
