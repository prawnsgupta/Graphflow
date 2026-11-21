import { describe, expect, it } from "vitest";
import {
  applyDeepFocus,
  classifySegments,
  DEFAULT_BILLING_RULES,
  DEFAULT_FOCUS_SETTINGS,
  isBillable,
  type ToolInfo,
} from "@/services/events/classification";
import type { Segment } from "@/services/events/reconstruction";
import { detectCollaboration } from "@/services/events/collaboration";

const MIN = 60_000;
const P = "p1";
const tools = new Map<string, ToolInfo>([
  ["Figma.exe", { id: "t-figma", name: "Figma", category: "DESIGN", defaultBillable: true }],
  ["chrome.exe", { id: "t-chrome", name: "Chrome", category: "BROWSER", defaultBillable: false }],
  ["slack.exe", { id: "t-slack", name: "Slack", category: "COMMUNICATION", defaultBillable: false }],
  ["EXCEL.EXE", { id: "t-excel", name: "Excel", category: "PRODUCTIVITY", defaultBillable: false }],
]);
const seg = (startMin: number, endMin: number, tool: string | null, extra: Partial<Segment> = {}): Segment => ({
  start: startMin * MIN,
  end: endMin * MIN,
  tool,
  projectId: P,
  file: null,
  idle: false,
  sourceEventId: `s${startMin}`,
  contextSwitch: false,
  ...extra,
});
const classify = (segments: Segment[]) =>
  classifySegments(segments, { tools, rules: () => DEFAULT_BILLING_RULES, focus: DEFAULT_FOCUS_SETTINGS });

describe("deep focus classification", () => {
  it("promotes a 30-minute uninterrupted run to DEEP_FOCUS", () => {
    expect(classify([seg(0, 30, "Figma.exe")])[0].category).toBe("DEEP_FOCUS");
  });

  it("leaves a 20-minute run as ACTIVE_WORK (below 25 minute threshold)", () => {
    expect(classify([seg(0, 20, "Figma.exe")])[0].category).toBe("ACTIVE_WORK");
  });

  it("tolerates a 1-minute interruption but does not count it", () => {
    const out = classify([seg(0, 13, "Figma.exe"), seg(13, 14, "slack.exe"), seg(14, 27, "Figma.exe")]);
    expect(out.map((s) => s.category)).toEqual(["DEEP_FOCUS", "COLLABORATION", "DEEP_FOCUS"]);
  });

  it("breaks the run on a 5-minute interruption", () => {
    const out = classify([seg(0, 15, "Figma.exe"), seg(15, 20, "chrome.exe"), seg(20, 35, "Figma.exe")]);
    expect(out.map((s) => s.category)).toEqual(["ACTIVE_WORK", "ACTIVE_WORK", "ACTIVE_WORK"]);
  });

  it("does not count idle towards focus", () => {
    const out = classify([seg(0, 15, "Figma.exe"), seg(15, 25, "Figma.exe", { idle: true }), seg(25, 40, "Figma.exe")]);
    expect(out.map((s) => s.category)).toEqual(["ACTIVE_WORK", "IDLE", "ACTIVE_WORK"]);
  });

  it("respects configurable thresholds", () => {
    const out = applyDeepFocus(
      [{ start: 0, end: 10 * MIN, projectId: P, toolId: "t", category: "ACTIVE_WORK" as const }],
      { deepFocusMinMs: 10 * MIN, deepFocusMaxGapMs: 0 },
    );
    expect(out[0].category).toBe("DEEP_FOCUS");
  });
});

describe("categories and billability", () => {
  it("classifies unassigned and idle as non-billable", () => {
    const out = classify([seg(0, 5, "Figma.exe", { projectId: null }), seg(5, 10, "Figma.exe", { idle: true })]);
    expect(out.map((s) => [s.category, s.isBillable])).toEqual([
      ["UNASSIGNED", false],
      ["IDLE", false],
    ]);
  });

  it("applies tool defaults and category rules", () => {
    const out = classify([seg(0, 5, "chrome.exe"), seg(5, 10, "slack.exe"), seg(10, 15, "EXCEL.EXE"), seg(15, 20, "Figma.exe")]);
    expect(out.map((s) => [s.category, s.isBillable])).toEqual([
      ["ACTIVE_WORK", false], // Chrome not billable by default
      ["COLLABORATION", true], // collaboration billable by project rule
      ["ADMINISTRATIVE", false], // administrative not billable by default
      ["ACTIVE_WORK", true],
    ]);
  });

  it("honours project tool overrides", () => {
    const rules = { ...DEFAULT_BILLING_RULES, billableToolIds: ["t-chrome"], nonBillableToolIds: ["t-figma"] };
    expect(isBillable({ category: "ACTIVE_WORK", projectId: P, toolId: "t-chrome" }, tools.get("chrome.exe"), rules)).toBe(true);
    expect(isBillable({ category: "DEEP_FOCUS", projectId: P, toolId: "t-figma" }, tools.get("Figma.exe"), rules)).toBe(false);
  });
});

describe("collaboration detection", () => {
  it("links two users overlapping on the same project", () => {
    const links = detectCollaboration(
      [{ userId: "u1", sessionId: "s1", projectId: P, start: 0, end: 30 * MIN, toolName: "Teams" }],
      [
        { userId: "u2", sessionId: "s2", projectId: P, start: 5 * MIN, end: 40 * MIN, toolName: "Teams" },
        { userId: "u3", sessionId: "s3", projectId: "other", start: 0, end: 30 * MIN, toolName: "Teams" },
      ],
      [10 * MIN],
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ targetUserId: "u2", durationSeconds: 25 * 60, contextSwitchCount: 1 });
  });
});
