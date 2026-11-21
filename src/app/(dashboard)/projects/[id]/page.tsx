import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { isAdmin } from "@/lib/permissions";
import { ProjectDetailView } from "@/components/projects/project-detail-view";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession("projects:view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <ProjectDetailView id={id} isAdmin={isAdmin(session.role)} />;
}
