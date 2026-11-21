/**
 * Activity scenarios for the SIMULATED desktop agent.
 *
 * Shared by the browser simulator and the trusted seed process. A scenario
 * is a list of steps at offsets (seconds); `expandScenario` turns it into
 * concrete events with timestamps, sequence numbers and periodic heartbeats.
 * Only operational metadata is produced: application, project, file
 * name/path and idle state. Never keystrokes, screenshots, clipboard, page
 * or message contents.
 */
import type { EventType, FileMetadata } from "@/lib/validation/events";

export type ScenarioId = "DEEP_DESIGN" | "INTERRUPTED_DEV" | "IDLE_PERIOD" | "COLLABORATION" | "MIXED_ADMIN";
export type Actor = "primary" | "partner";

export const TOOL_EXECUTABLES = {
  figma: "Figma.exe",
  photoshop: "Photoshop.exe",
  illustrator: "Illustrator.exe",
  vscode: "Code.exe",
  blender: "blender.exe",
  slack: "slack.exe",
  teams: "ms-teams.exe",
  chrome: "chrome.exe",
  excel: "EXCEL.EXE",
  notion: "Notion.exe",
} as const;

const T = TOOL_EXECUTABLES;

export interface ScenarioStep {
  at: number; // seconds from scenario start
  type: EventType;
  actor?: Actor;
  tool?: string;
  /** "project" = the selected project, null = explicitly unassigned */
  project?: "project" | null;
  file?: FileMetadata | null;
}

export interface ScenarioContext {
  projectKey: string;
  rand: () => number;
  /** Duration multiplier (seed varies it; simulator uses 1). */
  scale: number;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  description: string;
  requiresPartner: boolean;
  build: (ctx: ScenarioContext) => ScenarioStep[];
}

const file = (projectKey: string, name: string, type: string): FileMetadata => ({
  name,
  path: `~/work/${projectKey}/${name}`,
  type,
});

/** Round to whole seconds and keep steps ordered. */
const s = (min: number, ctx: ScenarioContext) => Math.round(min * 60 * ctx.scale);
const jitter = (ctx: ScenarioContext, spread = 1.5) => (ctx.rand() - 0.5) * spread;

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: "DEEP_DESIGN",
    name: "A · Deep design work",
    description: "Figma on a project design file with continuous focus and heartbeats for an extended period.",
    requiresPartner: false,
    build: (ctx) => {
      const f1 = file(ctx.projectKey, "homepage-redesign-v3.fig", "fig");
      const f2 = file(ctx.projectKey, "design-system-components.fig", "fig");
      return [
        { at: 0, type: "FOCUS_STARTED", tool: T.figma, project: "project", file: f1 },
        { at: 1, type: "APP_OPENED", tool: T.figma, project: "project", file: f1 },
        { at: s(48 + jitter(ctx, 6), ctx), type: "FILE_CONTEXT_CHANGED", tool: T.figma, file: f2 },
        { at: s(95 + jitter(ctx, 10), ctx), type: "FOCUS_ENDED" },
      ];
    },
  },
  {
    id: "INTERRUPTED_DEV",
    name: "B · Interrupted development",
    description: "VS Code on an assigned project with repeated switches to Chrome and Slack, then back.",
    requiresPartner: false,
    build: (ctx) => {
      const src = file(ctx.projectKey, "src/checkout/payment-form.tsx", "tsx");
      const test = file(ctx.projectKey, "src/checkout/payment-form.test.tsx", "tsx");
      const steps: ScenarioStep[] = [
        { at: 0, type: "FOCUS_STARTED", tool: T.vscode, project: "project", file: src },
        { at: 1, type: "APP_OPENED", tool: T.vscode, project: "project", file: src },
      ];
      const pattern: [number, string][] = [
        [12, T.chrome], [16, T.vscode], [24, T.slack], [27, T.vscode], [38, T.chrome],
        [41, T.vscode], [52, T.slack], [54, T.chrome], [57, T.vscode], [66, T.chrome], [68, T.vscode],
      ];
      for (const [min, tool] of pattern) {
        steps.push({ at: s(min + jitter(ctx, 1), ctx), type: "APPLICATION_SWITCH", tool });
      }
      steps.push({ at: s(46, ctx), type: "FILE_CONTEXT_CHANGED", tool: T.vscode, file: test });
      steps.push({ at: s(76 + jitter(ctx, 4), ctx), type: "FOCUS_ENDED" });
      return steps;
    },
  },
  {
    id: "IDLE_PERIOD",
    name: "C · Idle period",
    description: "Active session, then IDLE_STARTED, an idle stretch, IDLE_ENDED and resumed work.",
    requiresPartner: false,
    build: (ctx) => {
      const f = file(ctx.projectKey, "brand-guidelines.ai", "ai");
      return [
        { at: 0, type: "FOCUS_STARTED", tool: T.illustrator, project: "project", file: f },
        { at: 1, type: "APP_OPENED", tool: T.illustrator, project: "project", file: f },
        { at: s(22 + jitter(ctx, 4), ctx), type: "IDLE_STARTED" },
        { at: s(38 + jitter(ctx, 4), ctx), type: "IDLE_ENDED" },
        { at: s(66 + jitter(ctx, 6), ctx), type: "FOCUS_ENDED" },
      ];
    },
  },
  {
    id: "COLLABORATION",
    name: "D · Collaboration",
    description:
      "Two users on the same project overlap in a Teams session. Only session metadata is used — no communication contents.",
    requiresPartner: true,
    build: (ctx) => {
      const spec = file(ctx.projectKey, "sprint-review-notes.fig", "fig");
      return [
        { at: 0, type: "FOCUS_STARTED", actor: "primary", tool: T.figma, project: "project", file: spec },
        { at: 30, type: "FOCUS_STARTED", actor: "partner", tool: T.vscode, project: "project" },
        { at: s(10, ctx), type: "APPLICATION_SWITCH", actor: "primary", tool: T.teams },
        { at: s(10, ctx) + 20, type: "APPLICATION_SWITCH", actor: "partner", tool: T.teams },
        { at: s(36 + jitter(ctx, 4), ctx), type: "APPLICATION_SWITCH", actor: "primary", tool: T.figma },
        { at: s(37 + jitter(ctx, 4), ctx), type: "APPLICATION_SWITCH", actor: "partner", tool: T.vscode },
        { at: s(52, ctx), type: "FOCUS_ENDED", actor: "partner" },
        { at: s(55, ctx), type: "FOCUS_ENDED", actor: "primary" },
      ];
    },
  },
  {
    id: "MIXED_ADMIN",
    name: "E · Mixed administrative work",
    description:
      "Notion, Slack, Excel and Figma with context switches, including unassigned time and billable/non-billable work.",
    requiresPartner: false,
    build: (ctx) => {
      const sheet = file(ctx.projectKey, "q4-resource-plan.xlsx", "xlsx");
      const page = file(ctx.projectKey, "project-brief.notion", "notion");
      const design = file(ctx.projectKey, "campaign-assets.fig", "fig");
      return [
        { at: 0, type: "FOCUS_STARTED", tool: T.notion, project: "project", file: page },
        { at: 1, type: "APP_OPENED", tool: T.notion, project: "project", file: page },
        { at: s(10 + jitter(ctx), ctx), type: "APPLICATION_SWITCH", tool: T.slack },
        { at: s(18 + jitter(ctx), ctx), type: "PROJECT_CHANGED", project: null, tool: T.excel },
        { at: s(18 + jitter(ctx), ctx) + 2, type: "FILE_CONTEXT_CHANGED", tool: T.excel, file: sheet },
        { at: s(30, ctx), type: "PROJECT_CHANGED", project: "project", tool: T.figma },
        { at: s(30, ctx) + 2, type: "FILE_CONTEXT_CHANGED", tool: T.figma, file: design },
        { at: s(45 + jitter(ctx), ctx), type: "APPLICATION_SWITCH", tool: T.slack },
        { at: s(50 + jitter(ctx), ctx), type: "APPLICATION_SWITCH", tool: T.notion },
        { at: s(61 + jitter(ctx, 3), ctx), type: "FOCUS_ENDED" },
      ];
    },
  },
];

export function getScenario(id: ScenarioId): ScenarioDefinition {
  const def = SCENARIOS.find((x) => x.id === id);
  if (!def) throw new Error(`Unknown scenario ${id}`);
  return def;
}

export interface GeneratedEvent {
  actor: Actor;
  type: EventType;
  offsetMs: number;
  sequence: number;
  tool?: string;
  projectId?: string | null;
  file?: FileMetadata | null;
  idleSeconds?: number;
}

export interface ExpandOptions {
  projectId: string | null;
  heartbeatSeconds?: number;
  idleTimeoutSeconds?: number;
}

/**
 * Expand scenario steps into concrete events including SESSION_HEARTBEAT
 * events every `heartbeatSeconds` while each actor is focused. Heartbeats
 * report the current tool/project and, during idle, the seconds since input.
 */
export function expandScenario(steps: ScenarioStep[], opts: ExpandOptions): GeneratedEvent[] {
  const hb = (opts.heartbeatSeconds ?? 60) * 1000;
  const idleTimeout = (opts.idleTimeoutSeconds ?? 300) * 1000;
  const ordered = [...steps].sort((a, b) => a.at - b.at);
  const out: GeneratedEvent[] = [];

  for (const actor of ["primary", "partner"] as Actor[]) {
    const mine = ordered.filter((st) => (st.actor ?? "primary") === actor);
    if (mine.length === 0) continue;
    let tool: string | undefined;
    let projectId: string | null = null;
    let focused = false;
    let idleSince: number | null = null;
    let lastMs = 0;

    const emitHeartbeatsUntil = (untilMs: number) => {
      if (!focused) return;
      let t = lastMs + hb;
      while (t < untilMs) {
        out.push({
          actor,
          type: "SESSION_HEARTBEAT",
          offsetMs: t,
          sequence: 0,
          tool,
          projectId,
          idleSeconds: idleSince !== null ? Math.round((t - idleSince + idleTimeout) / 1000) : 3,
        });
        lastMs = t;
        t += hb;
      }
    };

    for (const st of mine) {
      const at = st.at * 1000;
      emitHeartbeatsUntil(at);
      const resolvedProject = st.project === undefined ? undefined : st.project === "project" ? opts.projectId : null;
      if (st.tool !== undefined) tool = st.tool;
      if (resolvedProject !== undefined) projectId = resolvedProject;
      if (st.type === "FOCUS_STARTED") focused = true;
      if (st.type === "FOCUS_ENDED") focused = false;
      if (st.type === "IDLE_STARTED") idleSince = at;
      if (st.type === "IDLE_ENDED") idleSince = null;
      out.push({
        actor,
        type: st.type,
        offsetMs: at,
        sequence: 0,
        tool: st.type === "FOCUS_ENDED" || st.type.startsWith("IDLE") ? undefined : st.tool,
        projectId: resolvedProject,
        file: st.file,
      });
      lastMs = at;
    }
  }

  out.sort((a, b) => a.offsetMs - b.offsetMs);
  const seq: Record<Actor, number> = { primary: 0, partner: 0 };
  for (const e of out) e.sequence = ++seq[e.actor];
  return out;
}

export function scenarioDurationMs(events: GeneratedEvent[]): number {
  return events.length ? events[events.length - 1].offsetMs : 0;
}

/** Deterministic PRNG (mulberry32) for reproducible seeds. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SIMULATION_SPEEDS = [
  { value: 1, label: "1x (real time)" },
  { value: 5, label: "5x" },
  { value: 10, label: "10x" },
  { value: 60, label: "60x · demo (1 h ≈ 1 min)" },
  { value: 300, label: "300x · fast demo" },
] as const;
