import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { ActivityView } from "@/components/activity/activity-view";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage() {
  const session = await requirePageSession("activity:view");
  return <ActivityView showEmployeeFilter={session.role !== "EMPLOYEE"} canSeeRaw={can(session.role, "activity:raw")} />;
}
