import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./format";
import { FlaskConical } from "lucide-react";

const TONES = {
  neutral: "border-border bg-secondary text-muted-foreground",
  primary: "border-primary/30 bg-primary/10 text-primary",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  violet: "border-violet/30 bg-violet/10 text-violet",
} as const;

export function ToneBadge({ tone = "neutral", children, className }: { tone?: keyof typeof TONES; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", TONES[tone], className)}>
      {children}
    </Badge>
  );
}

const TIMESHEET: Record<string, { tone: keyof typeof TONES; label: string }> = {
  DRAFT: { tone: "neutral", label: "Draft" },
  SUBMITTED: { tone: "primary", label: "Submitted" },
  APPROVED: { tone: "success", label: "Approved" },
  REJECTED: { tone: "danger", label: "Rejected" },
  ADJUSTMENT_REQUIRED: { tone: "warning", label: "Adjustment required" },
};
export function TimesheetStatusBadge({ status }: { status: string }) {
  const s = TIMESHEET[status] ?? { tone: "neutral" as const, label: status };
  return <ToneBadge tone={s.tone}>{s.label}</ToneBadge>;
}

const PROJECT: Record<string, keyof typeof TONES> = { PLANNING: "violet", ACTIVE: "success", ON_HOLD: "warning", COMPLETED: "primary", ARCHIVED: "neutral" };
export function ProjectStatusBadge({ status }: { status: string }) {
  return <ToneBadge tone={PROJECT[status] ?? "neutral"}>{status.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</ToneBadge>;
}

const PROCESSING: Record<string, keyof typeof TONES> = { PENDING: "warning", PROCESSING: "primary", RETRYING: "warning", PROCESSED: "success", FAILED: "danger", SKIPPED: "neutral" };
export function ProcessingBadge({ status }: { status: string }) {
  return <ToneBadge tone={PROCESSING[status] ?? "neutral"}>{status.toLowerCase()}</ToneBadge>;
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
      <span className="size-2 rounded-full" style={{ background: CATEGORY_COLORS[category] ?? "#64748b" }} />
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}

export function SimulatedBadge({ className }: { className?: string }) {
  return (
    <ToneBadge tone="warning" className={cn("gap-1 uppercase tracking-wide", className)}>
      <FlaskConical className="size-3" /> Simulated
    </ToneBadge>
  );
}

const ROLE_TONES: Record<string, keyof typeof TONES> = { SUPER_ADMIN: "danger", ORG_ADMIN: "violet", PROJECT_MANAGER: "primary", TEAM_LEAD: "success", EMPLOYEE: "neutral" };
const ROLE_LABELS: Record<string, string> = { SUPER_ADMIN: "Super admin", ORG_ADMIN: "Org admin", PROJECT_MANAGER: "Project manager", TEAM_LEAD: "Team lead", EMPLOYEE: "Employee" };
export function RoleBadge({ role }: { role: string }) {
  return <ToneBadge tone={ROLE_TONES[role] ?? "neutral"}>{ROLE_LABELS[role] ?? role}</ToneBadge>;
}
