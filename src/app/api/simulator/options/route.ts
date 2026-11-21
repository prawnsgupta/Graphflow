import { route } from "@/lib/api/handler";
import { simulatorOptions } from "@/services/simulator/simulator-service";

export const GET = route({ capability: "simulator:use" }, (ctx) => ctx.scope((s) => simulatorOptions(s)));
