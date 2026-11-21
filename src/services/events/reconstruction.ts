/**
 * Session reconstruction — pure functions, no I/O.
 *
 * Input: every accepted raw event of ONE activity session (any order).
 * Output: ordered, non-overlapping segments with a single context each
 * (tool, project, file, idle flag).
 *
 * Rules
 *  - Events are sorted by (timestamp, sequence, eventId); out-of-order
 *    delivery therefore cannot change the result.
 *  - Segments end at the last piece of EVIDENCE (an event). An open session
 *    never extends to "now": a browser tab being open proves nothing.
 *  - A gap between consecutive events longer than the heartbeat timeout
 *    closes the segment at the last evidence; the gap is not counted.
 *  - Repeated FOCUS_STARTED / FOCUS_ENDED / IDLE_* events are idempotent.
 *  - Any activity event while unfocused implicitly starts focus (tolerates a
 *    lost FOCUS_STARTED).
 *  - Heartbeats may carry idleSeconds; when it reaches the idle timeout the
 *    interval since the last input becomes idle (server-side idle detection).
 */
import type { EventType, FileMetadata } from "@/lib/validation/events";

export interface ReconEvent {
  id: string;
  type: EventType;
  ts: number; // epoch ms (UTC)
  seq: number;
  /** undefined = event did not specify; null = explicitly none */
  tool?: string | null;
  projectId?: string | null;
  file?: FileMetadata | null;
  idleSeconds?: number;
}

export interface Segment {
  start: number;
  end: number;
  tool: string | null;
  projectId: string | null;
  file: FileMetadata | null;
  idle: boolean;
  sourceEventId: string;
  /** This segment began because the active application or project changed. */
  contextSwitch: boolean;
}

export interface ReconOptions {
  heartbeatTimeoutMs: number;
  idleTimeoutMs: number;
}

export interface ReconResult {
  segments: Segment[];
  firstEventAt: number | null;
  lastEvidenceAt: number | null;
  /** True when the last meaningful event closed the session (FOCUS_ENDED). */
  ended: boolean;
  contextSwitches: number;
}

export function sortEvents<T extends { ts: number; seq: number; id: string }>(events: T[]): T[] {
  return [...events].sort((a, b) => a.ts - b.ts || a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function buildSegments(input: ReconEvent[], opts: ReconOptions): ReconResult {
  const events = sortEvents(input);
  const segments: Segment[] = [];

  let focused = false;
  let idle = false;
  let tool: string | null = null;
  let projectId: string | null = null;
  let file: FileMetadata | null = null;

  let open: { start: number; source: string; contextSwitch: boolean } | null = null;
  let lastEvidence: number | null = null;
  let ended = false;

  const close = (at: number) => {
    if (open && at > open.start) {
      segments.push({
        start: open.start,
        end: at,
        tool,
        projectId,
        file,
        idle,
        sourceEventId: open.source,
        contextSwitch: open.contextSwitch,
      });
    }
    open = null;
  };

  const openAt = (at: number, source: string, contextSwitch: boolean) => {
    open = { start: at, source, contextSwitch };
  };

  /** Close the current segment, apply a context change, open the next one. */
  const transition = (at: number, source: string, apply: () => void, isSwitch: boolean) => {
    if (open && at <= open.start) {
      // Zero-length segment: just merge the change into the open one.
      apply();
      const current = open as { start: number; source: string; contextSwitch: boolean };
      current.contextSwitch = current.contextSwitch || isSwitch;
      return;
    }
    close(at);
    apply();
    openAt(at, source, isSwitch);
  };

  const startFocus = (e: ReconEvent) => {
    focused = true;
    idle = false;
    ended = false;
    if (e.tool !== undefined) tool = e.tool;
    if (e.projectId !== undefined) projectId = e.projectId;
    if (e.file !== undefined) file = e.file;
    openAt(e.ts, e.id, false);
  };

  const switchKind = (nextTool: string | null | undefined, nextProject: string | null | undefined) => {
    const toolChanged = nextTool !== undefined && nextTool !== tool;
    const projectChanged = nextProject !== undefined && nextProject !== projectId;
    // A switch is a change between two real contexts (not from "nothing").
    const isSwitch = (toolChanged && tool !== null && nextTool !== null) || (projectChanged && segments.length + (open ? 1 : 0) > 0);
    return { changed: toolChanged || projectChanged, isSwitch };
  };

  for (const e of events) {
    // Missing heartbeat / device disconnect: close at last evidence.
    if (focused && lastEvidence !== null && e.ts - lastEvidence > opts.heartbeatTimeoutMs) {
      close(lastEvidence);
    }

    if (e.type === "FOCUS_ENDED") {
      if (focused) {
        close(e.ts);
        focused = false;
        idle = false;
        ended = true;
        lastEvidence = e.ts;
      }
      continue;
    }

    if (!focused) {
      // FOCUS_STARTED, or any activity implying focus after a lost start event.
      startFocus(e);
      if (e.type === "IDLE_STARTED") idle = true;
      lastEvidence = e.ts;
      continue;
    }

    // Re-open after a disconnect gap with the current context.
    if (!open) openAt(e.ts, e.id, false);

    switch (e.type) {
      case "FOCUS_STARTED": {
        // Repeated start: treat as a context refresh.
        const k = switchKind(e.tool, e.projectId);
        if (k.changed || idle)
          transition(e.ts, e.id, () => {
            if (e.tool !== undefined) tool = e.tool;
            if (e.projectId !== undefined) projectId = e.projectId;
            idle = false;
          }, k.isSwitch);
        break;
      }
      case "IDLE_STARTED": {
        if (!idle) transition(e.ts, e.id, () => (idle = true), false);
        break;
      }
      case "IDLE_ENDED": {
        if (idle) transition(e.ts, e.id, () => (idle = false), false);
        break;
      }
      case "APP_OPENED":
      case "APPLICATION_SWITCH": {
        const k = switchKind(e.tool ?? undefined, e.projectId);
        if (k.changed || idle) {
          transition(e.ts, e.id, () => {
            if (e.tool !== undefined) tool = e.tool;
            if (e.projectId !== undefined) projectId = e.projectId;
            if (e.file !== undefined) file = e.file;
            idle = false;
          }, k.isSwitch);
        } else if (e.file !== undefined && !sameFile(e.file, file)) {
          transition(e.ts, e.id, () => (file = e.file ?? null), false);
        }
        break;
      }
      case "APP_CLOSED": {
        if (e.tool !== undefined && e.tool === tool) {
          transition(e.ts, e.id, () => {
            tool = null;
            file = null;
          }, false);
        }
        break;
      }
      case "FILE_CONTEXT_CHANGED": {
        if (e.file !== undefined && !sameFile(e.file, file)) {
          transition(e.ts, e.id, () => {
            file = e.file ?? null;
            idle = false;
          }, false);
        }
        break;
      }
      case "PROJECT_CHANGED": {
        if (e.projectId !== undefined && e.projectId !== projectId) {
          transition(e.ts, e.id, () => {
            projectId = e.projectId ?? null;
            if (e.tool !== undefined) tool = e.tool;
            idle = false;
          }, true);
        }
        break;
      }
      case "SESSION_HEARTBEAT": {
        // Resync context if the collector reports something different.
        const k = switchKind(e.tool, e.projectId);
        const idleNow = e.idleSeconds !== undefined && e.idleSeconds * 1000 >= opts.idleTimeoutMs;
        if (idleNow && !idle) {
          const idleSince = Math.max(e.ts - (e.idleSeconds ?? 0) * 1000, open ? (open as { start: number }).start : e.ts);
          transition(idleSince, e.id, () => (idle = true), false);
        } else if (!idleNow && idle && e.idleSeconds !== undefined) {
          const activeSince = Math.max(e.ts - e.idleSeconds * 1000, open ? (open as { start: number }).start : e.ts);
          transition(activeSince, e.id, () => (idle = false), false);
        }
        if (k.changed) {
          transition(e.ts, e.id, () => {
            if (e.tool !== undefined) tool = e.tool;
            if (e.projectId !== undefined) projectId = e.projectId;
          }, k.isSwitch);
        }
        break;
      }
    }
    lastEvidence = e.ts;
  }

  if (focused && lastEvidence !== null) close(lastEvidence);

  const merged = mergeAdjacent(segments);
  return {
    segments: merged,
    firstEventAt: events.length ? events[0].ts : null,
    lastEvidenceAt: lastEvidence,
    ended: ended && !focused,
    contextSwitches: merged.filter((s) => s.contextSwitch).length,
  };
}

function sameFile(a: FileMetadata | null | undefined, b: FileMetadata | null | undefined) {
  if (!a || !b) return !a && !b;
  return a.path === b.path;
}

/** Merge touching segments with an identical context that were split by no-op transitions. */
export function mergeAdjacent(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.end === s.start &&
      !s.contextSwitch &&
      prev.tool === s.tool &&
      prev.projectId === s.projectId &&
      prev.idle === s.idle &&
      sameFile(prev.file, s.file)
    ) {
      prev.end = s.end;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/**
 * Remove time already covered by other sessions of the same user (e.g. two
 * devices running at once) so overlapping intervals are never counted twice.
 * `busy` intervals need not be sorted or disjoint.
 */
export function subtractIntervals<T extends { start: number; end: number }>(
  segments: T[],
  busy: { start: number; end: number }[],
): T[] {
  if (busy.length === 0) return segments;
  const sortedBusy = [...busy].sort((a, b) => a.start - b.start);
  const out: T[] = [];
  for (const seg of segments) {
    let pieces: T[] = [seg];
    for (const b of sortedBusy) {
      if (b.end <= seg.start || b.start >= seg.end) continue;
      const next: T[] = [];
      for (const p of pieces) {
        if (b.end <= p.start || b.start >= p.end) {
          next.push(p);
          continue;
        }
        if (b.start > p.start) next.push({ ...p, end: b.start });
        if (b.end < p.end) next.push({ ...p, start: b.end });
      }
      pieces = next;
    }
    out.push(...pieces.filter((p) => p.end - p.start >= 1000));
  }
  return out;
}
