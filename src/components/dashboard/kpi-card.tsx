import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label, value, unit, sub, icon: Icon, tone = "default", trend,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: React.ReactNode;
  icon: LucideIcon;
  tone?: "default" | "brand" | "success" | "warning" | "danger";
  trend?: number | null;
}) {
  const toneClass = {
    default: "bg-muted text-muted-foreground",
    brand: "bg-info-soft text-info-strong",
    success: "bg-success-soft text-success-strong",
    warning: "bg-warning-soft text-warning-strong",
    danger: "bg-danger-soft text-danger-strong",
  }[tone];
  return (
    <Card className="flex min-w-0 flex-col gap-2 p-3.5 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-keep text-xs font-medium text-muted-foreground">{label}</span>
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", toneClass)}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="tabular text-xl font-bold tracking-tight whitespace-nowrap sm:text-2xl">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      {(sub || trend !== undefined) && (
        <div className="flex min-h-4 items-center gap-1.5 text-xs text-muted-foreground">
          {trend !== undefined && <Trend value={trend} />}
          {sub}
        </div>
      )}
    </Card>
  );
}

/** 増減率：色＋矢印＋符号で表す */
export function Trend({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">比較データなし</span>;
  const up = value > 0;
  const flat = value === 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold tabular", flat ? "text-muted-foreground" : up ? "text-success-strong" : "text-danger-strong")}>
      <Icon className="size-3.5" aria-hidden />
      {up ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}
