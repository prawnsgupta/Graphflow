import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { TeamsView } from "@/components/teams/teams-view";

export const metadata: Metadata = { title: "Teams" };

export default async function TeamsPage() {
  const session = await requirePageSession("teams:view");
  return <TeamsView canManage={can(session.role, "teams:manage")} />;
}
