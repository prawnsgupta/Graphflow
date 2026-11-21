import type { Metadata } from "next";
import { OverviewView } from "@/components/dashboard/overview-view";
import { requirePageSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/permissions";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const session = await requirePageSession();
  const { denied } = await searchParams;
  const scope = isAdmin(session.role)
    ? "Organization-wide"
    : session.role === "PROJECT_MANAGER"
      ? "Projects you manage"
      : session.role === "TEAM_LEAD"
        ? "Your team"
        : "Your own activity";
  return (
    <>
      {denied && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          You do not have access to that page with your current role.
        </div>
      )}
      <OverviewView title={`Good to see you, ${session.displayName.split(" ")[0]}`} description={`${scope} · metrics computed from recorded activity in ${session.organization.timezone}.`} />
    </>
  );
}
