/**
 * Billing arithmetic. Seconds are integers; money is handled as integer
 * cents with BigInt, so no floating-point rounding errors occur. Values are
 * rounded only once, at the final presentation/storage step.
 */

export type RoundingRule = "NONE" | "UP_6_MIN" | "UP_15_MIN" | "NEAREST_15_MIN";

export function applyRounding(seconds: number, rule: RoundingRule): number {
  const s = Math.max(0, Math.trunc(seconds));
  switch (rule) {
    case "UP_6_MIN":
      return Math.ceil(s / 360) * 360;
    case "UP_15_MIN":
      return Math.ceil(s / 900) * 900;
    case "NEAREST_15_MIN":
      return Math.round(s / 900) * 900;
    default:
      return s;
  }
}

/** Parse a decimal string/number with up to 2 fraction digits into cents. */
export function toCents(value: string | number | { toString(): string }): bigint {
  const str = typeof value === "number" ? value.toFixed(2) : value.toString();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(str.trim());
  if (!m) throw new Error(`Invalid decimal: ${str}`);
  const frac = (m[3] ?? "").padEnd(3, "0");
  let cents = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1n; // half-up on the 3rd digit
  return m[1] === "-" ? -cents : cents;
}

export function centsToDecimalString(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/**
 * Billable Amount = (Billable Seconds / 3600) × Hourly Rate,
 * computed exactly and rounded half-up to the cent.
 */
export function billableAmount(billableSeconds: number, hourlyRate: string | number | { toString(): string }): string {
  const rateCents = toCents(hourlyRate);
  const secs = BigInt(Math.max(0, Math.trunc(billableSeconds)));
  const numerator = rateCents * secs * 2n + 3600n;
  return centsToDecimalString(numerator / 7200n);
}

export function sumDecimalStrings(values: (string | number | { toString(): string })[]): string {
  return centsToDecimalString(values.reduce<bigint>((acc, v) => acc + toCents(v), 0n));
}

/** Safe percentage: returns 0 for a zero denominator. Rounded to 2 decimals. */
export function pct(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator)) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

/** Budget Utilization = Approved Billable Hours / Budget Hours × 100. Null when no budget is set. */
export function budgetUtilization(approvedBillableSeconds: number, budgetHours: string | number | { toString(): string }): number | null {
  const budgetSeconds = Number(budgetHours.toString()) * 3600;
  if (!budgetSeconds) return null;
  return pct(approvedBillableSeconds, budgetSeconds);
}

export const billableHours = (seconds: number) => seconds / 3600;
