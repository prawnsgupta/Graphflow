/**
 * Segment classification — pure functions.
 *
 * Activity category (what kind of work) is independent from billability
 * (a financial rule configured per project). Deep focus is a classification
 * of active work, never a billing rule by itself.
 */
import type { Segment } from "./reconstruction";

export type ActivityCategory = "DEEP_FOCUS" | "ACTIVE_WORK" | "COLLABORATION" | "ADMINISTRATIVE" | "IDLE" | "UNASSIGNED";

export type ToolCategory =
  | "DESIGN"
  | "DEVELOPMENT"
  | "THREE_D"
  | "BROWSER"
  | "COMMUNICATION"
  | "PRODUCTIVITY"
  | "DOCUMENTATION"
  | "OTHER";

export interface ToolInfo {
  id: string;
  name: string;
  category: ToolCategory;
  defaultBillable: boolean;
}

export interface BillingRules {
  billableCategories: ActivityCategory[];
  collaborationBillable: boolean;
  administrativeBillable: boolean;
  billableToolIds: string[];
  nonBillableToolIds: string[];
}

export const DEFAULT_BILLING_RULES: BillingRules = {
  billableCategories: ["DEEP_FOCUS", "ACTIVE_WORK"],
  collaborationBillable: true,
  administrativeBillable: false,
  billableToolIds: [],
  nonBillableToolIds: [],
};

export interface FocusSettings {
  deepFocusMinMs: number;
  deepFocusMaxGapMs: number;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  deepFocusMinMs: 25 * 60_000,
  deepFocusMaxGapMs: 2 * 60_000,
};

export interface ClassifiedSegment extends Segment {
  toolId: string | null;
  category: ActivityCategory;
  isBillable: boolean;
}

/** Base category from the segment context, before deep-focus promotion. */
export function baseCategory(seg: Pick<Segment, "idle" | "projectId">, tool: ToolInfo | undefined): ActivityCategory {
  if (seg.idle) return "IDLE";
  if (!seg.projectId) return "UNASSIGNED";
  switch (tool?.category) {
    case "COMMUNICATION":
      return "COLLABORATION";
    case "PRODUCTIVITY":
    case "DOCUMENTATION":
      return "ADMINISTRATIVE";
    default:
      return "ACTIVE_WORK";
  }
}

/**
 * Promote ACTIVE_WORK segments to DEEP_FOCUS when they form an uninterrupted
 * run on the same project and tool lasting at least `deepFocusMinMs`.
 * Interruptions (other tools, idle, gaps) of up to `deepFocusMaxGapMs` are
 * tolerated but never counted towards the focus duration.
 */
export function applyDeepFocus<T extends { start: number; end: number; projectId: string | null; toolId: string | null; category: ActivityCategory }>(
  segments: T[],
  settings: FocusSettings,
): T[] {
  const result = segments.map((s) => ({ ...s }));
  const byKey = new Map<string, number[]>();
  result.forEach((s, i) => {
    if (s.category !== "ACTIVE_WORK") return;
    const key = `${s.projectId}|${s.toolId}`;
    const list = byKey.get(key) ?? [];
    list.push(i);
    byKey.set(key, list);
  });

  for (const indices of byKey.values()) {
    indices.sort((a, b) => result[a].start - result[b].start);
    let run: number[] = [];
    const flush = () => {
      const active = run.reduce((sum, i) => sum + (result[i].end - result[i].start), 0);
      if (active >= settings.deepFocusMinMs) for (const i of run) result[i].category = "DEEP_FOCUS";
      run = [];
    };
    for (const i of indices) {
      if (run.length > 0) {
        const prev = result[run[run.length - 1]];
        const gap = result[i].start - prev.end;
        // Any idle time inside the gap counts as interruption time; gaps longer
        // than the tolerance break the run.
        if (gap > settings.deepFocusMaxGapMs) flush();
      }
      run.push(i);
    }
    flush();
  }
  return result;
}

export function isBillable(
  seg: { category: ActivityCategory; projectId: string | null; toolId: string | null },
  tool: ToolInfo | undefined,
  rules: BillingRules,
): boolean {
  if (!seg.projectId || seg.category === "IDLE" || seg.category === "UNASSIGNED") return false;
  if (seg.toolId && rules.nonBillableToolIds.includes(seg.toolId)) return false;
  const toolForced = !!seg.toolId && rules.billableToolIds.includes(seg.toolId);
  switch (seg.category) {
    case "COLLABORATION":
      return toolForced || rules.collaborationBillable;
    case "ADMINISTRATIVE":
      return toolForced || rules.administrativeBillable;
    case "DEEP_FOCUS":
    case "ACTIVE_WORK": {
      // DEEP_FOCUS inherits ACTIVE_WORK billability unless configured separately.
      const categoryOk =
        rules.billableCategories.includes(seg.category) ||
        (seg.category === "DEEP_FOCUS" && rules.billableCategories.includes("ACTIVE_WORK"));
      if (!categoryOk) return false;
      return toolForced || (tool?.defaultBillable ?? false);
    }
    default:
      return false;
  }
}

export function classifySegments(
  segments: Segment[],
  ctx: {
    tools: Map<string, ToolInfo>; // keyed by executable name
    rules: (projectId: string) => BillingRules;
    focus: FocusSettings;
  },
): ClassifiedSegment[] {
  const withBase = segments.map((s) => {
    const tool = s.tool ? ctx.tools.get(s.tool) : undefined;
    return { ...s, toolId: tool?.id ?? null, category: baseCategory(s, tool), isBillable: false };
  });
  const focused = applyDeepFocus(withBase, ctx.focus);
  return focused.map((s) => {
    const tool = s.tool ? ctx.tools.get(s.tool) : undefined;
    return { ...s, isBillable: s.projectId ? isBillable(s, tool, ctx.rules(s.projectId)) : false };
  });
}
