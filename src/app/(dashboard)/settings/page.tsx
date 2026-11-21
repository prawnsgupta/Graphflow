import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requirePageSession();
  const { tab } = await searchParams;
  return <SettingsView isAdmin={can(session.role, "settings:organization")} initialTab={tab} />;
}
