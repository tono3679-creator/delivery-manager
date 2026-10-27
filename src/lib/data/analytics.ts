import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { addDays, addMonths, daysBetween, endOfMonth, isDateString, startOfMonth, type DateString } from "@/lib/date";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/domain/labels";
import { getClientRanking, getDriverPerformance, getSalesSeries, toDateString } from "./dashboard";

/**
 * 売上・利益分析。数字はすべて DB の集計関数（analytics_*）から取得し、
 * ダッシュボード・ドライバー詳細・荷主詳細と同じ定義で計算する。
 */

export const PERIOD_PRESETS = ["this_month", "last_month", "last_3_months", "last_6_months", "custom"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

const periodSchema = z.object({
  period: z.enum(PERIOD_PRESETS).optional().catch(undefined),
  from: z.string().refine(isDateString).optional().catch(undefined),
  to: z.string().refine(isDateString).optional().catch(undefined),
});

export type Period = { preset: PeriodPreset; from: DateString; to: DateString; grain: "day" | "week" | "month"; label: string };

/** URL の期間指定を検証して集計期間にする（未来日は今日まで、最長2年） */
export function resolvePeriod(params: Record<string, string | string[] | undefined>, today: DateString): Period {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  const p = periodSchema.parse(flat);
  const preset: PeriodPreset = p.period ?? (p.from && p.to ? "custom" : "this_month");
  let from: DateString;
  let to: DateString = today;
  let label: string;
  switch (preset) {
    case "last_month": {
      from = startOfMonth(addMonths(today, -1));
      to = endOfMonth(from);
      label = "先月";
      break;
    }
    case "last_3_months":
      from = startOfMonth(addMonths(today, -2));
      label = "直近3か月";
      break;
    case "last_6_months":
      from = startOfMonth(addMonths(today, -5));
      label = "直近6か月";
      break;
    case "custom": {
      from = p.from ?? startOfMonth(today);
      to = p.to && p.to < today ? p.to : today;
      if (from > to) [from, to] = [to, from];
      if (daysBetween(from, to) > 731) from = addDays(to, -731);
      label = "指定期間";
      break;
    }
    default:
      from = startOfMonth(today);
      label = "今月";
  }
  const days = daysBetween(from, to) + 1;
  const grain = days <= 45 ? "day" : days <= 120 ? "week" : "month";
  return { preset, from, to, grain, label };
}

export type AnalyticsSummary = {
  revenue: number;
  expense: number;
  grossProfit: number;
  grossMargin: number | null;
  orderCount: number;
  deliveredCount: number;
  lateCount: number;
  /** 平均単価（配送完了1件あたりの売上） */
  averageFee: number | null;
  lateRate: number | null;
};

export async function getAnalyticsSummary(tx: Tx, from: DateString, to: DateString): Promise<AnalyticsSummary> {
  const [r] = await tx<{ revenue: number; expense: number; gross_profit: number; gross_margin: number | null; order_count: number; delivered_count: number; late_count: number }[]>`
    select * from analytics_summary(${from}::date, ${to}::date)`;
  return {
    revenue: r.revenue,
    expense: r.expense,
    grossProfit: r.gross_profit,
    grossMargin: r.gross_margin,
    orderCount: r.order_count,
    deliveredCount: r.delivered_count,
    lateCount: r.late_count,
    averageFee: r.delivered_count === 0 ? null : Math.round(r.revenue / r.delivered_count),
    lateRate: r.order_count === 0 ? null : Math.round((r.late_count / r.order_count) * 1000) / 10,
  };
}

export async function getExpenseBreakdown(tx: Tx, from: DateString, to: DateString) {
  const rows = await tx<{ category: ExpenseCategory; amount: number }[]>`
    select * from analytics_expense_breakdown(${from}::date, ${to}::date)`;
  return rows.map((r) => ({ category: r.category, amount: r.amount }));
}

/**
 * 比較する前の期間。
 *   今月 → 前月の同じ日まで / 先月 → 前々月 / 直近3・6か月 → その前の3・6か月 / 指定期間 → 直前の同じ日数
 */
export function previousPeriod(period: Period): { from: DateString; to: DateString; label: string } {
  switch (period.preset) {
    case "this_month":
      return { from: addMonths(period.from, -1), to: addMonths(period.to, -1), label: "前月同期" };
    case "last_month": {
      const from = addMonths(period.from, -1);
      return { from, to: endOfMonth(from), label: "前々月" };
    }
    case "last_3_months":
      return { from: addMonths(period.from, -3), to: addMonths(period.to, -3), label: "その前の3か月" };
    case "last_6_months":
      return { from: addMonths(period.from, -6), to: addMonths(period.to, -6), label: "その前の6か月" };
    default: {
      const to = addDays(period.from, -1);
      return { from: addDays(to, -daysBetween(period.from, period.to)), to, label: "直前の同じ日数" };
    }
  }
}

/** 自社の記録の開始日（最初の案件の配送予定日と最初の経費の日付の早いほう）。記録がなければ null */
export async function getRecordStart(tx: Tx): Promise<DateString | null> {
  const [r] = await tx<{ start: string | null }[]>`
    select least(
      (select (min(delivery_at) at time zone 'Asia/Tokyo')::date from delivery_orders),
      (select min(spent_on) from expenses)
    )::text as start`;
  return r.start as DateString | null;
}

export async function getAnalytics(tx: Tx, period: Period) {
  const prev = previousPeriod(period);
  const [summary, previous, series, breakdown, drivers, clients, recordStart] = await Promise.all([
    getAnalyticsSummary(tx, period.from, period.to),
    getAnalyticsSummary(tx, prev.from, prev.to),
    getSalesSeries(tx, period.from, period.to, period.grain),
    getExpenseBreakdown(tx, period.from, period.to),
    getDriverPerformance(tx, period.from, period.to),
    getClientRanking(tx, period.from, period.to),
    getRecordStart(tx),
  ]);
  // 比較する期間の途中から記録が始まっている場合は、増減率を出さない（記録のない日を 0 として比べると極端な値になる）
  const complete = recordStart !== null && recordStart <= prev.from;
  return { summary, previous: { ...previous, ...prev, complete, recordStart }, series, breakdown, drivers, clients };
}

// ---------------------------------------------------------------
// 経費の一覧
// ---------------------------------------------------------------

export const EXPENSE_PAGE_SIZE = 30;

const expenseFilterSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});

export function parseExpenseFilters(params: Record<string, string | string[] | undefined>) {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  return expenseFilterSchema.parse(flat);
}

export type ExpenseRow = {
  id: string;
  spentOn: string;
  category: ExpenseCategory;
  amount: number;
  driverId: string | null;
  driverName: string | null;
  vehicleId: string | null;
  vehiclePlate: string | null;
  description: string | null;
};

export async function listExpenses(tx: Tx, period: Period, f: z.infer<typeof expenseFilterSchema>) {
  const page = f.page ?? 1;
  const where = tx`x.spent_on between ${period.from}::date and ${period.to}::date ${f.category ? tx`and x.category = ${f.category}` : tx``}`;
  const [rows, [count]] = await Promise.all([
    tx<{ id: string; spent_on: string; category: ExpenseCategory; amount: number; driver_id: string | null; driver_name: string | null; vehicle_id: string | null; plate_number: string | null; description: string | null }[]>`
      select x.id, x.spent_on, x.category, x.amount, x.driver_id, d.name driver_name, x.vehicle_id, v.plate_number, x.description
        from expenses x left join drivers d on d.id = x.driver_id left join vehicles v on v.id = x.vehicle_id
       where ${where}
       order by x.spent_on desc, x.created_at desc, x.id
       limit ${EXPENSE_PAGE_SIZE} offset ${(page - 1) * EXPENSE_PAGE_SIZE}`,
    tx<{ n: number; total: number }[]>`select count(*) n, coalesce(sum(x.amount), 0) total from expenses x where ${where}`,
  ]);
  return {
    rows: rows.map<ExpenseRow>((r) => ({
      id: r.id, spentOn: toDateString(r.spent_on), category: r.category, amount: r.amount, driverId: r.driver_id, driverName: r.driver_name,
      vehicleId: r.vehicle_id, vehiclePlate: r.plate_number, description: r.description,
    })),
    total: count.n,
    amount: count.total,
    page,
    pageCount: Math.max(1, Math.ceil(count.n / EXPENSE_PAGE_SIZE)),
  };
}

export type ExpenseFormOptions = {
  drivers: { id: string; name: string; retired: boolean }[];
  vehicles: { id: string; plate: string; retired: boolean }[];
};

/** 経費フォームの選択肢（過去の経費を直せるよう、退職者・廃車も含める） */
export async function getExpenseFormOptions(tx: Tx): Promise<ExpenseFormOptions> {
  const [drivers, vehicles] = await Promise.all([
    tx<{ id: string; name: string; status: string }[]>`select id, name, status from drivers order by case status when 'retired' then 1 else 0 end, code`,
    tx<{ id: string; plate_number: string; status: string }[]>`select id, plate_number, status from vehicles order by case status when 'retired' then 1 else 0 end, code`,
  ]);
  return {
    drivers: drivers.map((d) => ({ id: d.id, name: d.name, retired: d.status === "retired" })),
    vehicles: vehicles.map((v) => ({ id: v.id, plate: v.plate_number, retired: v.status === "retired" })),
  };
}
