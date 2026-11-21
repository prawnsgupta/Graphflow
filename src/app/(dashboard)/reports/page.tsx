import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { ReportsView } from "@/components/reports/reports-view";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const session = await requirePageSession("reports:view");
  return <ReportsView showFilters={session.role !== "EMPLOYEE"} />;
}
