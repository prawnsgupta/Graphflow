/**
 * Collaboration detection — pure functions.
 *
 * A collaboration link is recorded when two DIFFERENT users assigned to the
 * SAME project are both in a collaboration-category interval on that project
 * at the same time. Only session metadata (time, project, tool category) is
 * used; communication contents are never inspected or stored.
 */

export interface CollabInterval {
  userId: string;
  sessionId: string;
  projectId: string;
  start: number;
  end: number;
  toolName: string | null;
}

export interface CollabLinkDraft {
  sourceUserId: string;
  targetUserId: string;
  projectId: string;
  sourceSessionId: string;
  targetSessionId: string;
  interactionType: string;
  start: number;
  end: number;
  durationSeconds: number;
  contextSwitchCount: number;
}

export const MIN_COLLAB_OVERLAP_MS = 60_000;

export function detectCollaboration(
  mine: CollabInterval[],
  others: CollabInterval[],
  switchTimes: number[],
  minOverlapMs = MIN_COLLAB_OVERLAP_MS,
): CollabLinkDraft[] {
  // Merge overlapping pieces per (target session) so one meeting = one link.
  const drafts = new Map<string, CollabLinkDraft>();
  for (const a of mine) {
    for (const b of others) {
      if (a.userId === b.userId || a.projectId !== b.projectId) continue;
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (end - start < 1000) continue;
      const key = `${a.sessionId}|${b.sessionId}|${a.projectId}`;
      const existing = drafts.get(key);
      if (existing && start <= existing.end + 60_000) {
        existing.start = Math.min(existing.start, start);
        existing.end = Math.max(existing.end, end);
      } else if (!existing) {
        drafts.set(key, {
          sourceUserId: a.userId,
          targetUserId: b.userId,
          projectId: a.projectId,
          sourceSessionId: a.sessionId,
          targetSessionId: b.sessionId,
          interactionType: a.toolName && a.toolName === b.toolName ? `CO_SESSION:${a.toolName}` : "CO_SESSION",
          start,
          end,
          durationSeconds: 0,
          contextSwitchCount: 0,
        });
      }
    }
  }
  return [...drafts.values()]
    .map((d) => ({
      ...d,
      durationSeconds: Math.round((d.end - d.start) / 1000),
      contextSwitchCount: switchTimes.filter((t) => t >= d.start && t < d.end).length,
    }))
    .filter((d) => d.end - d.start >= minOverlapMs);
}
