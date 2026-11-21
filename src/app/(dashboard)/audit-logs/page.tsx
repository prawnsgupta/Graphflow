import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/permissions";
import { AuditView } from "@/components/audit/audit-view";

export const metadata: Metadata = { title: "Audit logs" };

export default async function AuditLogsPage() {
  const session = await requirePageSession("audit:view");
  return <AuditView scopeNote={isAdmin(session.role) ? "Showing the whole organization." : "Showing your own actions and events on projects you manage."} />;
}
