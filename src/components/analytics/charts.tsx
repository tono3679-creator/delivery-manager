"use client";
/**
 * 売上分析・ドライバー詳細・荷主詳細のグラフ（Recharts）。
 * 色は検証済みの順番で使う：1 売上（ブルー）/ 2 経費（オレンジ）/ 3 粗利益（アクア）。
 * アクアは白地とのコントラストが 3:1 未満のため、凡例の文字と「表で見る」を必ず併用する。
 */
import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber, formatPercent, formatYen, formatYenCompact } from "@/lib/format";
import type { SeriesPoint } from "@/lib/data/dashboard";
import { SERIES_COLORS } from "./colors";

const GRID = "var(--border)";
const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };

export type Grain = "day" | "week" | "month";

export function bucketLabel(bucket: string, grain: Grain): string {
  const [y, m, d] = bucket.split("-").map(Number);
  if (grain === "month") return m === 1 ? `${y}年1月` : `${m}月`;
  if (grain === "week") return `${m}/${d}週`;
  return `${m}/${d}`;
}

function Swatch({ color, line }: { color: string; line?: boolean }) {
  return line ? (
    <span className="relative inline-block h-2.5 w-4 shrink-0" aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded" style={{ background: color }} />
      <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card" style={{ background: color }} />
    </span>
  ) : (
    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden />
  );
}

// ---------------------------------------------------------------
// 売上・経費・粗利益の推移
// ---------------------------------------------------------------

type ProfitPoint = SeriesPoint & { label: string };

function ProfitTooltip({ active, payload }: { active?: boolean; payload?: { payload: ProfitPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const margin = p.revenue === 0 ? null : Math.round((p.grossProfit / p.revenue) * 1000) / 10;
  const rows = [
    { label: "売上", value: p.revenue, color: SERIES_COLORS.revenue },
    { label: "経費", value: p.expense, color: SERIES_COLORS.expense },
    { label: "粗利益", value: p.grossProfit, color: SERIES_COLORS.profit, line: true },
  ];
  return (
    <div className="min-w-44 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-foreground">{p.label}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 py-0.5 text-muted-foreground">
          <Swatch color={r.color} line={r.line} />
          {r.label}
          <span className="ml-auto pl-3 font-semibold text-foreground tabular">{formatYen(r.value)}</span>
        </div>
      ))}
      <div className="mt-1 flex border-t pt-1 text-muted-foreground">
        粗利益率<span className="ml-auto pl-3 tabular text-foreground">{formatPercent(margin)}</span>
      </div>
      <div className="flex text-muted-foreground">
        配送件数<span className="ml-auto pl-3 tabular text-foreground">{formatNumber(p.orders, "件")}</span>
      </div>
    </div>
  );
}

export function ProfitTrendChart({ data, grain }: { data: SeriesPoint[]; grain: Grain }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const points = data.map((p) => ({ ...p, label: bucketLabel(p.bucket, grain) }));
  const hasNegative = points.some((p) => p.grossProfit < 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="凡例">
          <li className="flex items-center gap-1.5"><Swatch color={SERIES_COLORS.revenue} />売上</li>
          <li className="flex items-center gap-1.5"><Swatch color={SERIES_COLORS.expense} />経費</li>
          <li className="flex items-center gap-1.5"><Swatch color={SERIES_COLORS.profit} line />粗利益</li>
        </ul>
        <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
          <TabsList aria-label="表示方法">
            <TabsTrigger value="chart">グラフ</TabsTrigger>
            <TabsTrigger value="table">表で見る</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {view === "chart" ? (
        <div className="h-72" role="img" aria-label={`売上・経費・粗利益の推移（${grain === "day" ? "日別" : grain === "week" ? "週別" : "月別"}）`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barGap={2} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} width={60} tickFormatter={(v: number) => formatYenCompact(v)} />
              {hasNegative && <ReferenceLine y={0} stroke="var(--muted-foreground)" />}
              <Tooltip cursor={{ fill: "var(--muted)" }} content={<ProfitTooltip />} />
              <Bar dataKey="revenue" name="売上" fill={SERIES_COLORS.revenue} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              <Bar dataKey="expense" name="経費" fill={SERIES_COLORS.expense} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              <Line dataKey="grossProfit" name="粗利益" stroke={SERIES_COLORS.profit} strokeWidth={2} isAnimationActive={false}
                dot={points.length <= 31 ? { r: 4, strokeWidth: 2, stroke: "var(--card)", fill: SERIES_COLORS.profit } : false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-72 overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead className="pl-4">期間</TableHead>
                <TableHead className="text-right">売上</TableHead>
                <TableHead className="text-right">経費</TableHead>
                <TableHead className="text-right">粗利益</TableHead>
                <TableHead className="text-right">粗利益率</TableHead>
                <TableHead className="pr-4 text-right">配送件数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((p) => (
                <TableRow key={p.bucket}>
                  <TableCell className="pl-4 whitespace-nowrap">{p.label}</TableCell>
                  <TableCell className="text-right tabular">{formatYen(p.revenue)}</TableCell>
                  <TableCell className="text-right tabular">{formatYen(p.expense)}</TableCell>
                  <TableCell className={`text-right tabular ${p.grossProfit < 0 ? "text-danger-strong" : ""}`}>{formatYen(p.grossProfit)}</TableCell>
                  <TableCell className="text-right tabular">{formatPercent(p.revenue === 0 ? null : (p.grossProfit / p.revenue) * 100)}</TableCell>
                  <TableCell className="pr-4 text-right tabular">{formatNumber(p.orders, "件")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// 月別の売上（ドライバー詳細・荷主詳細。1系列なので凡例は付けない）
// ---------------------------------------------------------------

type MonthPoint = { bucket: string; revenue: number; orders: number; delivered: number; late: number };

function MonthTooltip({ active, payload }: { active?: boolean; payload?: { payload: MonthPoint & { label: string } }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-foreground">{p.label}</div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Swatch color={SERIES_COLORS.revenue} />売上
        <span className="ml-auto pl-3 font-semibold text-foreground tabular">{formatYen(p.revenue)}</span>
      </div>
      <div className="flex text-muted-foreground">配送件数<span className="ml-auto pl-3 tabular text-foreground">{formatNumber(p.orders, "件")}</span></div>
      <div className="flex text-muted-foreground">配送完了<span className="ml-auto pl-3 tabular text-foreground">{formatNumber(p.delivered, "件")}</span></div>
      <div className="flex text-muted-foreground">遅延<span className="ml-auto pl-3 tabular text-foreground">{formatNumber(p.late, "件")}</span></div>
    </div>
  );
}

export function MonthlyRevenueChart({ data, label }: { data: MonthPoint[]; label: string }) {
  const points = data.map((p) => ({ ...p, label: bucketLabel(p.bucket, "month") }));
  return (
    <div className="h-56" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 16, right: 4, left: 4, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatYenCompact(v)} />
          <Tooltip cursor={{ fill: "var(--muted)" }} content={<MonthTooltip />} />
          <Bar dataKey="revenue" fill={SERIES_COLORS.revenue} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
