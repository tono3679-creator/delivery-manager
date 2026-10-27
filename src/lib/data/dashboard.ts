import "server-only";
import type { Tx } from "@/lib/db";
import { addDays, addMonths, startOfMonth, todayJst, type DateString } from "@/lib/date";
import { DEADLINE_WARNING_DAYS } from "@/lib/domain/deadline";
import type { OrderStatus } from "@/lib/domain/status";

export type DashboardKpis = {
  day: string;
  planned: number;
  delivered: number;
  inProgress: number;
  notStarted: number;
  unassigned: number;
  failed: number;
  /** 予定を過ぎても完了していない案件 */
  late: number;
  /** 予定より遅れて完了した案件 */
  lateDelivered: number;
  completionRate: number | null;
  activeDrivers: number;
  expectedRevenueToday: number;
  monthRevenue: number;
  monthExpense: number;
  monthGrossProfit: number;
  monthGrossMargin: number | null;
  prevMonthRevenueSamePeriod: number;
  revenueMoM: number | null;
};

export type SeriesPoint = { bucket: string; revenue: number; expense: number; grossProfit: number; orders: number };

export async function getDashboardKpis(tx: Tx, day: DateString = todayJst()): Promise<DashboardKpis> {
  const [row] = await tx<{ k: Record<string, number | string | null> }[]>`select dashboard_kpis(${day}::date) k`;
  const k = row.k;
  const n = (key: string) => Number(k[key] ?? 0);
  const nn = (key: string) => (k[key] === null || k[key] === undefined ? null : Number(k[key]));
  return {
    day: String(k.day),
    planned: n("planned"),
    delivered: n("delivered"),
    inProgress: n("inProgress"),
    notStarted: n("notStarted"),
    unassigned: n("unassigned"),
    failed: n("failed"),
    late: n("late"),
    lateDelivered: n("lateDelivered"),
    completionRate: nn("completionRate"),
    activeDrivers: n("activeDrivers"),
    expectedRevenueToday: n("expectedRevenueToday"),
    monthRevenue: n("monthRevenue"),
    monthExpense: n("monthExpense"),
    monthGrossProfit: n("monthGrossProfit"),
    monthGrossMargin: nn("monthGrossMargin"),
    prevMonthRevenueSamePeriod: n("prevMonthRevenueSamePeriod"),
    revenueMoM: nn("revenueMoM"),
  };
}

export async function getSalesSeries(tx: Tx, from: DateString, to: DateString, grain: "day" | "week" | "month"): Promise<SeriesPoint[]> {
  const rows = await tx<{ bucket: Date; revenue: number; expense: number; gross_profit: number; order_count: number }[]>`
    select bucket, revenue, expense, gross_profit, order_count from analytics_series(${from}::date, ${to}::date, ${grain})`;
  return rows.map((r) => ({
    bucket: toDateString(r.bucket),
    revenue: r.revenue,
    expense: r.expense,
    grossProfit: r.gross_profit,
    orders: r.order_count,
  }));
}

/** ダッシュボードの売上推移（日別30日・週別12週・月別6か月） */
export async function getDashboardSeries(tx: Tx, today: DateString = todayJst()) {
  const [day, week, month] = await Promise.all([
    getSalesSeries(tx, addDays(today, -29), today, "day"),
    getSalesSeries(tx, addDays(today, -7 * 11 - 6), today, "week"),
    getSalesSeries(tx, startOfMonth(addMonths(today, -5)), today, "month"),
  ]);
  return { day, week, month };
}

export type DriverPerformance = { driverId: string; name: string; delivered: number; orders: number; late: number; revenue: number; completionRate: number | null };

export async function getDriverPerformance(tx: Tx, from: DateString, to: DateString): Promise<DriverPerformance[]> {
  const rows = await tx<{ driver_id: string; driver_name: string; order_count: number; delivered_count: number; late_count: number; revenue: number; completion_rate: number | null }[]>`
    select * from analytics_by_driver(${from}::date, ${to}::date)`;
  return rows.map((r) => ({
    driverId: r.driver_id, name: r.driver_name, delivered: r.delivered_count, orders: r.order_count,
    late: r.late_count, revenue: r.revenue, completionRate: r.completion_rate,
  }));
}

export type ClientRevenue = { clientId: string; name: string; orders: number; revenue: number };

export async function getClientRanking(tx: Tx, from: DateString, to: DateString): Promise<ClientRevenue[]> {
  const rows = await tx<{ client_id: string; client_name: string; order_count: number; revenue: number }[]>`
    select * from analytics_by_client(${from}::date, ${to}::date)`;
  return rows.map((r) => ({ clientId: r.client_id, name: r.client_name, orders: r.order_count, revenue: r.revenue }));
}

export type TodayOrder = {
  id: string;
  orderNo: string;
  clientName: string;
  driverName: string | null;
  deliveryName: string;
  deliveryAddress: string;
  deliveryAt: Date;
  status: OrderStatus;
  isLate: boolean;
};

export async function getTodayOrders(tx: Tx, today: DateString = todayJst(), limit = 8): Promise<TodayOrder[]> {
  // 進行中・未着手を先に、その中で配送予定が近い順
  const rows = await tx<{ id: string; order_no: string; client_name: string; driver_name: string | null; delivery_name: string; delivery_address: string; delivery_at: Date; status: OrderStatus; is_late: boolean }[]>`
    select o.id, o.order_no, c.name client_name, d.name driver_name, o.delivery_name, o.delivery_address,
           o.delivery_at, o.status, f.is_late
      from delivery_orders o
      join v_order_facts f on f.id = o.id
      join clients c on c.id = o.client_id
      left join drivers d on d.id = o.driver_id
     where o.delivery_at >= app.jst_start(${today}::date) and o.delivery_at < app.jst_start(${today}::date + 1)
     order by case when o.status in ('picked_up','in_transit') then 0
                   when o.status in ('unassigned','assigned') then 1 else 2 end,
              f.is_late desc, o.delivery_at
     limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, orderNo: r.order_no, clientName: r.client_name, driverName: r.driver_name, deliveryName: r.delivery_name,
    deliveryAddress: r.delivery_address, deliveryAt: r.delivery_at, status: r.status, isLate: r.is_late,
  }));
}

export type DashboardAlerts = {
  lateOrders: { id: string; orderNo: string; deliveryName: string; driverName: string | null; deliveryAt: Date }[];
  lateCount: number;
  unassignedToday: number;
  unassignedUpcoming: number;
  inspection: { id: string; plate: string; date: string; days: number }[];
  insurance: { id: string; plate: string; date: string; days: number }[];
};

export async function getDashboardAlerts(tx: Tx, today: DateString = todayJst()): Promise<DashboardAlerts> {
  const late = await tx<{ id: string; order_no: string; delivery_name: string; driver_name: string | null; delivery_at: Date }[]>`
    select o.id, o.order_no, o.delivery_name, d.name driver_name, o.delivery_at
      from v_order_facts f join delivery_orders o on o.id = f.id left join drivers d on d.id = o.driver_id
     where f.is_late and f.status in ('unassigned','assigned','picked_up','in_transit')
     order by o.delivery_at`;
  const [un] = await tx<{ today: number; upcoming: number }[]>`
    select count(*) filter (where delivery_at < app.jst_start(${today}::date + 1)) today,
           count(*) filter (where delivery_at >= app.jst_start(${today}::date + 1)) upcoming
      from delivery_orders
     where status = 'unassigned' and delivery_at >= app.jst_start(${today}::date)
       and delivery_at < app.jst_start(${today}::date + 8)`;
  const vehicles = await tx<{ id: string; plate_number: string; inspection_expires_on: Date; insurance_expires_on: Date; insp_days: number; ins_days: number }[]>`
    select id, plate_number, inspection_expires_on, insurance_expires_on,
           inspection_expires_on - ${today}::date insp_days, insurance_expires_on - ${today}::date ins_days
      from vehicles
     where status <> 'retired'
       and (inspection_expires_on <= ${today}::date + ${DEADLINE_WARNING_DAYS}::int or insurance_expires_on <= ${today}::date + ${DEADLINE_WARNING_DAYS}::int)`;
  return {
    lateOrders: late.slice(0, 5).map((r) => ({ id: r.id, orderNo: r.order_no, deliveryName: r.delivery_name, driverName: r.driver_name, deliveryAt: r.delivery_at })),
    lateCount: late.length,
    unassignedToday: un.today,
    unassignedUpcoming: un.upcoming,
    inspection: vehicles.filter((v) => v.insp_days <= DEADLINE_WARNING_DAYS).sort((a, b) => a.insp_days - b.insp_days)
      .map((v) => ({ id: v.id, plate: v.plate_number, date: toDateString(v.inspection_expires_on), days: v.insp_days })),
    insurance: vehicles.filter((v) => v.ins_days <= DEADLINE_WARNING_DAYS).sort((a, b) => a.ins_days - b.ins_days)
      .map((v) => ({ id: v.id, plate: v.plate_number, date: toDateString(v.insurance_expires_on), days: v.ins_days })),
  };
}

/** DB の date 型（UTC 0時の Date で届く）を 'YYYY-MM-DD' にする */
export function toDateString(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
