import { SERIES_COLORS } from "./colors";

/** 構成比：数字＋細い横棒（1系列なので単色） */
export function ShareBar({ value }: { value: number | null }) {
  return (
    <div className="ml-auto flex w-32 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%`, background: SERIES_COLORS.revenue }} />
      </div>
      <span className="w-12 text-right text-xs tabular text-muted-foreground">{value === null ? "—" : `${value.toFixed(1)}%`}</span>
    </div>
  );
}
