import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { can, isAdmin } from "@/lib/permissions";
import { BillingView } from "@/components/billing/billing-view";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage() {
  const session = await requirePageSession("billing:view");
  return (
    <BillingView
      userId={session.userId}
      isReviewer={can(session.role, "billing:review")}
      isAdmin={isAdmin(session.role)}
      canAudit={can(session.role, "billing:audit")}
    />
  );
}
