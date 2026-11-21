export { formatDuration, formatHours, secondsToHours } from "@/lib/utils/time";

export function formatMoney(amount: string | number, currency = "USD"): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
}

export function formatPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function formatNumber(v: number, digits = 0): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatDate(d: string | Date | null | undefined, tz?: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(new Date(d));
}

export function formatDateTime(d: string | Date | null | undefined, tz?: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));
}

export function formatTime(d: string | Date, tz?: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(d));
}

/** Period end is exclusive in storage; display the last included day. */
export function formatPeriod(start: string | Date, end: string | Date, tz?: string): string {
  const last = new Date(new Date(end).getTime() - 1);
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" });
  return `${f.format(new Date(start))} – ${f.format(last)}`;
}

export function hoursInput(seconds: number) {
  return Math.round((seconds / 3600) * 100) / 100;
}

export const CATEGORY_LABELS: Record<string, string> = {
  DEEP_FOCUS: "Deep focus",
  ACTIVE_WORK: "Active work",
  COLLABORATION: "Collaboration",
  ADMINISTRATIVE: "Administrative",
  IDLE: "Idle",
  UNASSIGNED: "Unassigned",
};

export const CATEGORY_COLORS: Record<string, string> = {
  DEEP_FOCUS: "#647CFF",
  ACTIVE_WORK: "#38BDF8",
  COLLABORATION: "#8B5CF6",
  ADMINISTRATIVE: "#F59E0B",
  IDLE: "#475569",
  UNASSIGNED: "#EF4444",
};
