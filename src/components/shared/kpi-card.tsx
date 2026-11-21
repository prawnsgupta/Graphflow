import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  info,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "default" | "primary" | "success" | "warning" | "danger" | "violet";
  info?: string;
  loading?: boolean;
}) {
  const toneClass = {
    default: "text-muted-foreground bg-secondary",
    primary: "text-primary bg-primary/10",
    success: "text-success bg-success/10",
    warning: "text-warning bg-warning/10",
    danger: "text-destructive bg-destructive/10",
    violet: "text-violet bg-violet/10",
  }[tone];
  return (
    <Card className="gap-0 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {label}
          {info && (
            <Tooltip>
              <TooltipTrigger aria-label={`About ${label}`}>
                <Info className="size-3.5 opacity-60" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{info}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {Icon && (
          <span className={cn("flex size-7 items-center justify-center rounded-md", toneClass)}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-24" />
      ) : (
        <div className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      )}
      {hint && !loading && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}
