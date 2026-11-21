import { route } from "@/lib/api/handler";
import { analyticsQuery, uuid } from "@/lib/validation/common";
import { overview } from "@/services/analytics/analytics-service";
import { getProject } from "@/services/projects/project-service";

export const GET = route<{ id: string }>({ capability: "projects:view" }, (ctx) => {
  const id = uuid.parse(ctx.params.id);
  const q = ctx.query(analyticsQuery);
  return ctx.scope(async (s) => {
    await getProject(s, id); // 404 when the project is not visible
    return overview(s, { ...q, projectId: id });
  });
});
