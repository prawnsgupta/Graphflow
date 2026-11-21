import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { can, isAdmin } from "@/lib/permissions";
import { ProjectsView } from "@/components/projects/projects-view";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const session = await requirePageSession("projects:view");
  return <ProjectsView canCreate={can(session.role, "projects:create")} isAdmin={isAdmin(session.role)} />;
}
