import { AlertOctagon, AlertTriangle, Info, TrendingDown, Lightbulb } from "lucide-react";
import type { InsightDTO } from "@/types/api";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/states";

const ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info, positive: TrendingDown };
const TONE = {
  critical: "text-destructive bg-destructive/10 border-destructive/25",
  warning: "text-warning bg-warning/10 border-warning/25",
  info: "text-primary bg-primary/10 border-primary/25",
  positive: "text-success bg-success/10 border-success/25",
};

export function InsightsList({ insights, limit }: { insights: InsightDTO[]; limit?: number }) {
  if (insights.length === 0)
    return <EmptyState icon={Lightbulb} title="No insights right now" description="Insights appear when budgets, switching, focus or approvals cross configured thresholds." />;
  return (
    <ul className="space-y-2.5">
      {insights.slice(0, limit).map((i) => {
        const Icon = ICON[i.severity];
        return (
          <li key={i.id} className="rounded-lg border border-border bg-surface-2/40 p-3">
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border", TONE[i.severity])}>
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">{i.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{i.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="tabular rounded bg-secondary px-1.5 py-0.5 text-foreground">
                    {i.metric.label}: {i.metric.value}
                    {i.metric.unit === "%" ? "%" : ` ${i.metric.unit}`}
                    {i.metric.previous !== undefined && <span className="text-muted-foreground"> (was {i.metric.previous})</span>}
                  </span>
                  <span>{i.related.name}</span>
                </div>
                <p className="mt-2 text-xs text-foreground/80">
                  <span className="text-muted-foreground">Recommended: </span>
                  {i.recommendation}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
