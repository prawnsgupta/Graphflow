/**
 * Timezone helpers. All instants are stored in UTC; reporting buckets use the
 * organization's IANA timezone. Implemented with Intl only (no tz database
 * dependency) and safe across DST transitions.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(date: Date | number, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(new Date(date));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** Offset (ms) of `tz` from UTC at the given instant. Positive east of UTC. */
export function tzOffsetMs(date: Date | number, tz: string): number {
  const ms = new Date(date).getTime();
  const p = localParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function dateKeyInTz(date: Date | number, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function parseKey(key: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Invalid date key: ${key}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** UTC instant of local midnight at the start of `dateKey` in `tz`. */
export function zonedMidnightUtc(dateKey: string, tz: string): Date {
  return zonedTimeUtc(dateKey, 0, 0, tz);
}

/** UTC instant of a local wall-clock time on `dateKey` in `tz`. */
export function zonedTimeUtc(dateKey: string, hour: number, minute: number, tz: string): Date {
  const [y, m, d] = parseKey(dateKey);
  const guess = Date.UTC(y, m - 1, d, hour, minute, 0);
  let result = guess - tzOffsetMs(guess, tz);
  // Re-check once: the offset can differ at the corrected instant around DST.
  const second = guess - tzOffsetMs(result, tz);
  if (second !== result) result = second;
  return new Date(result);
}

export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = parseKey(dateKey);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** ISO weekday 1 (Mon) .. 7 (Sun) of a date key. */
export function isoWeekday(dateKey: string): number {
  const [y, m, d] = parseKey(dateKey);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function startOfWeekKey(dateKey: string): string {
  return addDaysToKey(dateKey, 1 - isoWeekday(dateKey));
}

/** Inclusive list of date keys between two keys. */
export function eachDateKey(fromKey: string, toKey: string, max = 400): string[] {
  const out: string[] = [];
  let k = fromKey;
  while (k <= toKey && out.length < max) {
    out.push(k);
    k = addDaysToKey(k, 1);
  }
  return out;
}

/** Convert a local [fromKey, toKey] date range (inclusive) into a UTC half-open interval. */
export function localRangeToUtc(fromKey: string, toKey: string, tz: string): { start: Date; end: Date } {
  return { start: zonedMidnightUtc(fromKey, tz), end: zonedMidnightUtc(addDaysToKey(toKey, 1), tz) };
}

// ---------------------------------------------------------------------------
// Formatting (UI + reports)
// ---------------------------------------------------------------------------

export function secondsToHours(seconds: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round((seconds / 3600) * f) / f;
}

export function formatHours(seconds: number, digits = 1): string {
  return `${secondsToHours(seconds, digits).toLocaleString("en-US", { maximumFractionDigits: digits })}h`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s % 60)}s`;
  return `${s}s`;
}

export function formatDateTimeInTz(date: Date | string | number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(date));
}

export function formatDateInTz(date: Date | string | number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(
    new Date(date),
  );
}
