"use client";
import { Suspense } from "react";
import { Discover } from "@/components/ely/discover";

export default function Page() {
  return (
    <Suspense>
      <Discover />
    </Suspense>
  );
}
