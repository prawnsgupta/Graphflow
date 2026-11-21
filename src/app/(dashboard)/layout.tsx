import { AppShell } from "@/components/layout/app-shell";
import { requirePageSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();
  return (
    <AppShell
      user={{
        displayName: session.displayName,
        email: session.email,
        role: session.role,
        trackingConsent: session.trackingConsent,
        organization: session.organization,
      }}
    >
      {children}
    </AppShell>
  );
}
