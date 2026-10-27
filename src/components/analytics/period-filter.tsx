"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PRESETS = [
  { value: "this_month", label: "今月" },
  { value: "last_month", label: "先月" },
  { value: "last_3_months", label: "直近3か月" },
  { value: "last_6_months", label: "直近6か月" },
  { value: "custom", label: "期間を指定" },
] as const;

/**
 * 集計期間の切り替え。条件は URL（period / from / to）に保存する。
 * 実際の期間はサーバーが検証して決める（未来日は今日まで、最長2年）。
 */
export function PeriodFilter({ preset, from, to, today }: { preset: string; from: string; to: string; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState(preset === "custom");
  const [range, setRange] = useState({ from, to });

  const go = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const selectPreset = (value: string) => {
    if (value === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    go({ period: value === "this_month" ? null : value, from: null, to: null });
  };

  const active = custom ? "custom" : preset;

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="集計期間">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={active === p.value}
            onClick={() => selectPreset(p.value)}
            className={cn(
              "h-8 rounded-full border px-3.5 text-sm font-medium transition-colors",
              active === p.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {custom && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ period: "custom", from: range.from, to: range.to });
          }}
        >
          <Input type="date" aria-label="集計期間（から）" value={range.from} max={today} required
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="w-40" />
          <span className="text-muted-foreground">〜</span>
          <Input type="date" aria-label="集計期間（まで）" value={range.to} max={today} required
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="w-40" />
          <Button type="submit" size="sm">表示</Button>
        </form>
      )}
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="集計中" />}
    </div>
  );
}
