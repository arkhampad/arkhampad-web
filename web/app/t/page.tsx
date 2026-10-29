"use client";
import { Suspense } from "react";
import { TokenPage } from "@/components/ely/token";

export default function Page() {
  return (
    <Suspense>
      <TokenPage />
    </Suspense>
  );
}
