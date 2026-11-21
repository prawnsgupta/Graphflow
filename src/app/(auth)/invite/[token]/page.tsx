import type { Metadata } from "next";
import { AcceptInvitationForm } from "@/components/auth/password-forms";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptInvitationForm token={token} />;
}
