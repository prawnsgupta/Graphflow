"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
  type TooltipContentProps,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/states";
import { BarChart3 } from "lucide-react";

const AXIS = { stroke: "#64748b", fontSize: 11, tickLine: false, axisLine: false } as const;
const GRID = { stroke: "#1e2a44", strokeDasharray: "3 3", vertical: false } as const;
export const PALETTE = ["#647CFF", "#8B5CF6", "#22C55E", "#F59E0B", "#38BDF8", "#EF4444", "#EC4899", "#14B8A6", "#A3A3A3", "#F97316"];

const hrs = (s: number) => Math.round((s / 3600) * 10) / 10;
const shortDate = (k: string) => {
  const [, m, d] = k.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}`;
};

function ChartTooltip({ active, payload, label, unit = "h", formatLabel }: Partial<TooltipContentProps<number, string>> & { unit?: string; formatLabel?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <p className="mb-1 font-medium text-foreground">{formatLabel ? formatLabel(String(label)) : String(label)}</p>}
      {payload.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: (p.color as string) ?? (p.payload as { fill?: string })?.fill }} />
          <span>{p.name}</span>
          <span className="tabular ml-auto pl-3 font-medium text-foreground">
            {typeof p.value === "number" ? p.value.toLocaleString("en-US", { maximumFractionDigits: 1 }) : p.value}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ChartCard({
  title,
  description,
  loading,
  empty,
  children,
  height = 260,
  action,
}: {
  title: string;
  description?: string;
  loading?: boolean;
  empty?: boolean;
  children: React.ReactNode;
  height?: number;
  action?: React.ReactNode;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row items-start justify-between gap-2 px-4">
        <div>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {description && <CardDescription className="mt-0.5 text-xs">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
        <div style={{ height }}>
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : empty ? (
            <EmptyState icon={BarChart3} title="No data for this period" description="Run the simulator or widen the date range." className="h-full" />
          ) : (
            children
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export interface DayPoint {
  date: string;
  trackedSeconds: number;
  activeSeconds: number;
  billableSeconds: number;
  deepFocusSeconds: number;
  activeWorkSeconds: number;
  collaborationSeconds: number;
  administrativeSeconds: number;
  idleSeconds: number;
  frictionSeconds: number;
  contextSwitches: number;
  switchesPerHour: number;
  focusRatio: number;
}

export function TrackedBillableChart({ days }: { days: DayPoint[] }) {
  const data = days.map((d) => ({ date: d.date, Tracked: hrs(d.trackedSeconds), Billable: hrs(d.billableSeconds) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="gTracked" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#647CFF" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#647CFF" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gBillable" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22C55E" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#22C55E" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} minTickGap={16} />
        <YAxis {...AXIS} unit="h" />
        <Tooltip content={<ChartTooltip formatLabel={shortDate} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Area type="monotone" dataKey="Tracked" stroke="#647CFF" fill="url(#gTracked)" strokeWidth={2} />
        <Area type="monotone" dataKey="Billable" stroke="#22C55E" fill="url(#gBillable)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function FocusBreakdownChart({ days }: { days: DayPoint[] }) {
  const data = days.map((d) => ({
    date: d.date,
    "Deep focus": hrs(d.deepFocusSeconds),
    "Interrupted / shallow": hrs(d.activeWorkSeconds),
    Collaboration: hrs(d.collaborationSeconds),
    Administrative: hrs(d.administrativeSeconds),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} minTickGap={16} />
        <YAxis {...AXIS} unit="h" />
        <Tooltip content={<ChartTooltip formatLabel={shortDate} />} cursor={{ fill: "#1c2942", opacity: 0.5 }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Deep focus" stackId="a" fill="#647CFF" />
        <Bar dataKey="Interrupted / shallow" stackId="a" fill="#38BDF8" />
        <Bar dataKey="Collaboration" stackId="a" fill="#8B5CF6" />
        <Bar dataKey="Administrative" stackId="a" fill="#F59E0B" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ToolUsageChart({ tools }: { tools: { name: string; seconds: number }[] }) {
  const top = tools.slice(0, 7);
  const rest = tools.slice(7).reduce((s, t) => s + t.seconds, 0);
  const data = [...top, ...(rest > 0 ? [{ name: "Other", seconds: rest }] : [])].map((t) => ({ name: t.name, value: hrs(t.seconds) }));
  return (
    <div className="flex h-full flex-col gap-3 sm:flex-row sm:items-center">
      <div className="h-[180px] w-full sm:h-full sm:w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={2} stroke="none">
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex-1 space-y-1.5 text-xs">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="truncate text-muted-foreground">{d.name}</span>
            <span className="tabular ml-auto font-medium">{d.value}h</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BudgetChart({ budgets }: { budgets: { name: string; utilizationPct: number | null; approvedBillableSeconds: number; pendingBillableSeconds: number; budgetHours: number }[] }) {
  const data = budgets
    .filter((b) => b.budgetHours > 0)
    .map((b) => ({
      name: b.name,
      Approved: Math.round((b.approvedBillableSeconds / 3600 / b.budgetHours) * 1000) / 10,
      Pending: Math.round((b.pendingBillableSeconds / 3600 / b.budgetHours) * 1000) / 10,
    }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4 }}>
        <CartesianGrid {...GRID} horizontal={false} vertical />
        <XAxis type="number" {...AXIS} unit="%" domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]} />
        <YAxis type="category" dataKey="name" {...AXIS} width={130} tick={{ fill: "#94a3b8", fontSize: 11 }} />
        <Tooltip content={<ChartTooltip unit="%" />} cursor={{ fill: "#1c2942", opacity: 0.5 }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine x={100} stroke="#EF4444" strokeDasharray="4 4" />
        <Bar dataKey="Approved" stackId="b" fill="#647CFF" barSize={14} />
        <Bar dataKey="Pending" stackId="b" fill="#8B5CF6" fillOpacity={0.5} radius={[0, 3, 3, 0]} barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SwitchTrendChart({ days }: { days: DayPoint[] }) {
  const data = days.map((d) => ({ date: d.date, Switches: d.contextSwitches, "Per active hour": d.switchesPerHour }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} minTickGap={16} />
        <YAxis yAxisId="l" {...AXIS} />
        <YAxis yAxisId="r" orientation="right" {...AXIS} />
        <Tooltip content={<ChartTooltip unit="" formatLabel={shortDate} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Line yAxisId="l" type="monotone" dataKey="Switches" stroke="#F59E0B" strokeWidth={2} dot={false} />
        <Line yAxisId="r" type="monotone" dataKey="Per active hour" stroke="#8B5CF6" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ProductivityTrendChart({ days }: { days: DayPoint[] }) {
  const data = days.map((d) => ({ date: d.date, "Active hours": hrs(d.activeSeconds), "Focus ratio %": d.focusRatio, "Friction hours": hrs(d.frictionSeconds) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS} minTickGap={16} />
        <YAxis yAxisId="l" {...AXIS} />
        <YAxis yAxisId="r" orientation="right" {...AXIS} unit="%" domain={[0, 100]} />
        <Tooltip content={<ChartTooltip unit="" formatLabel={shortDate} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Line yAxisId="l" type="monotone" dataKey="Active hours" stroke="#38BDF8" strokeWidth={2} dot={false} />
        <Line yAxisId="l" type="monotone" dataKey="Friction hours" stroke="#EF4444" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
        <Line yAxisId="r" type="monotone" dataKey="Focus ratio %" stroke="#647CFF" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBars({ items, unit = "h" }: { items: { name: string; value: number }[]; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => (
        <li key={`${it.name}-${i}`} className="text-xs">
          <div className="mb-1 flex justify-between gap-2">
            <span className="truncate text-muted-foreground">{it.name}</span>
            <span className="tabular font-medium">
              {it.value.toLocaleString("en-US", { maximumFractionDigits: 1 })}
              {unit}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary">
            <div className="h-1.5 rounded-full" style={{ width: `${(it.value / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
