import type { Tx } from "@/lib/db/context";
import type { ToolInfo } from "@/services/events/classification";

/** Tools keyed by executable name (case-insensitive). */
export async function loadToolMap(tx: Tx, organizationId: string): Promise<Map<string, ToolInfo>> {
  const tools = await tx.tool.findMany({
    where: { organizationId },
    select: { id: true, name: true, category: true, executableName: true, defaultBillableStatus: true },
  });
  const map = new Map<string, ToolInfo>();
  for (const t of tools) {
    const info: ToolInfo = { id: t.id, name: t.name, category: t.category, defaultBillable: t.defaultBillableStatus };
    map.set(t.executableName, info);
    map.set(t.executableName.toLowerCase(), info);
  }
  return map;
}

export function lookupTool(map: Map<string, ToolInfo>, executable: string | null | undefined): ToolInfo | undefined {
  if (!executable) return undefined;
  return map.get(executable) ?? map.get(executable.toLowerCase());
}
