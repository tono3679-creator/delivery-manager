"use client";
/**
 * ダッシュボード・分析のグラフ（Recharts）。
 * 1系列のグラフは単色（ブルー）。ステータスの内訳だけは状態色＋凡例の文字と件数で表す。
 */
import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber, formatYen, formatYenCompact } from "@/lib/format";
import type { SeriesPoint } from "@/lib/data/dashboard";

const SERIES = "#2a78d6";
const GRID = "var(--border)";
const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };

function bucketLabel(bucket: string, grain: "day" | "week" | "month"): string {
  const [, m, d] = bucket.split("-").map(Number);
  if (grain === "month") return `${m}月`;
  if (grain === "week") return `${m}/${d}週`;
  return `${m}/${d}`;
}

function ChartTooltip({ active, payload, label, valueLabel, format }: {
  active?: boolean; payload?: { value: number; payload: Record<string, unknown> }[]; label?: string;
  valueLabel: string; format: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const extra = payload[0].payload.orders;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-foreground">{label}</div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="size-2 rounded-sm" style={{ background: SERIES }} aria-hidden />
        {valueLabel}
        <span className="ml-auto pl-3 font-semibold text-foreground tabular">{format(payload[0].value)}</span>
      </div>
      {typeof extra === "number" && (
        <div className="mt-0.5 flex text-muted-foreground">
          配送件数<span className="ml-auto pl-3 tabular text-foreground">{formatNumber(extra, "件")}</span>
        </div>
      )}
    </div>
  );
}

export function SalesTrendChart({ data }: { data: Record<"day" | "week" | "month", SeriesPoint[]> }) {
  const [grain, setGrain] = useState<"day" | "week" | "month">("day");
  const points = data[grain].map((p) => ({ ...p, label: bucketLabel(p.bucket, grain) }));
  const total = points.reduce((s, p) => s + p.revenue, 0);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs text-muted-foreground">
            {grain === "day" ? "直近30日" : grain === "week" ? "直近12週" : "直近6か月"}の売上合計
          </div>
          <div className="tabular text-lg font-bold">{formatYen(total)}</div>
        </div>
        <Tabs value={grain} onValueChange={(v) => setGrain(v as typeof grain)}>
          <TabsList aria-label="集計単位">
            <TabsTrigger value="day">日別</TabsTrigger>
            <TabsTrigger value="week">週別</TabsTrigger>
            <TabsTrigger value="month">月別</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="h-64" role="img" aria-label="売上推移の棒グラフ">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatYenCompact(v)} />
            <Tooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltip valueLabel="売上" format={formatYen} />} />
            <Bar dataKey="revenue" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const STATUS_GROUPS = [
  { key: "notStarted", label: "未着手", color: "#2a78d6" },
  { key: "inProgress", label: "集荷済・配送中", color: "#eda100" },
  { key: "delivered", label: "配送完了", color: "#1baf7a" },
  { key: "failed", label: "配送失敗", color: "#d03b3b" },
] as const;

export function StatusDonut({ counts }: { counts: Record<(typeof STATUS_GROUPS)[number]["key"], number> }) {
  const data = STATUS_GROUPS.map((g) => ({ ...g, value: counts[g.key] }));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative size-44 shrink-0" role="img" aria-label={`本日の配送ステータス内訳（合計${total}件）`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.filter((d) => d.value > 0)} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%"
              paddingAngle={2} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
              {data.filter((d) => d.value > 0).map((d) => <Cell key={d.key} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={(v) => formatNumber(Number(v), "件")} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-2xl font-bold">{total}</span>
          <span className="text-xs text-muted-foreground">件</span>
        </div>
      </div>
      <ul className="grid w-full max-w-xs gap-2 text-sm">
        {data.map((d) => (
          <li key={d.key} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: d.color }} aria-hidden />
            <span className="text-keep text-muted-foreground">{d.label}</span>
            <span className="ml-auto tabular font-semibold">{d.value}件</span>
            <span className="w-12 text-right tabular text-xs text-muted-foreground">
              {total > 0 ? `${Math.round((d.value / total) * 100)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 横棒グラフ（ドライバー別・荷主別など、1系列） */
const FORMATTERS = {
  count: (v: number) => `${formatNumber(v)}件`,
  yen: (v: number) => formatYen(v),
  yenCompact: (v: number) => formatYenCompact(v),
} as const;

export function HorizontalBars({
  data, valueLabel, unit, height,
}: { data: { name: string; value: number }[]; valueLabel: string; unit: "count" | "yen"; height?: number }) {
  const format = unit === "count" ? FORMATTERS.count : FORMATTERS.yen;
  const labelFormat = unit === "count" ? FORMATTERS.count : FORMATTERS.yenCompact;
  const h = height ?? Math.max(160, data.length * 30 + 20);
  return (
    <div style={{ height: h }} role="img" aria-label={`${valueLabel}の横棒グラフ`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" tick={{ ...AXIS, fill: "var(--foreground)" }} tickLine={false} axisLine={false} width={132} />
          <Tooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltip valueLabel={valueLabel} format={format} />} />
          <Bar dataKey="value" fill={SERIES} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}
            label={{ position: "right", fontSize: 11, fill: "var(--muted-foreground)", formatter: (v: unknown) => labelFormat(Number(v)) }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
