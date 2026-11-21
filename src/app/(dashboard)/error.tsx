"use client";

import { ErrorState } from "@/components/shared/states";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState message={error.digest ? `Reference ${error.digest}` : error.message} onRetry={reset} />;
}
