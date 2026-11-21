import { route } from "@/lib/api/handler";
import { uuid } from "@/lib/validation/common";
import { getProject, projectAuditHistory } from "@/services/projects/project-service";

export const GET = route<{ id: string }>({ capability: "projects:view" }, (ctx) => {
  const id = uuid.parse(ctx.params.id);
  return ctx.scope(async (s) => {
    await getProject(s, id);
    return projectAuditHistory(s, id);
  });
});
