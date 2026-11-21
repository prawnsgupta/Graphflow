import { route } from "@/lib/api/handler";
import { listInvitations } from "@/services/employees/employee-service";

export const GET = route({ capability: "employees:manage" }, (ctx) => ctx.scope((s) => listInvitations(s)));
