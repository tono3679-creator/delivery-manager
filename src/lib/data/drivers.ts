import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { addMonths, startOfMonth, type DateString } from "@/lib/date";
import { DRIVER_STATUSES, EMPLOYMENT_TYPES, type DriverStatus, type EmploymentType } from "@/lib/domain/labels";
import type { OrderStatus } from "@/lib/domain/status";
import { toDateString } from "./dashboard";

const filterSchema = z.object({
  q: z.string().trim().max(50).optional().catch(undefined),
  status: z.enum(DRIVER_STATUSES).optional().catch(undefined),
  employment: z.enum(EMPLOYMENT_TYPES).optional().catch(undefined),
});
export type DriverFilters = z.infer<typeof filterSchema>;

export function parseDriverFilters(params: Record<string, string | string[] | undefined>): DriverFilters {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  return filterSchema.parse(flat);
}

export type DriverRow = {
  id: string;
  code: string;
  name: string;
  nameKana: string | null;
  phone: string | null;
  employmentType: EmploymentType;
  status: DriverStatus;
  officeName: string | null;
  vehiclePlate: string | null;
  /** 今月（1日〜本日）の実績。集計は analytics_by_driver（売上分析と同じ関数） */
  monthDelivered: number;
  monthOrders: number;
  monthLate: number;
  monthRevenue: number;
  completionRate: number | null;
};

export async function listDrivers(tx: Tx, f: DriverFilters, today: DateString): Promise<DriverRow[]> {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const rows = await tx<{
    id: string; code: string; name: string; name_kana: string | null; phone: string | null; employment_type: EmploymentType;
    status: DriverStatus; office_name: string | null; plate_number: string | null;
    order_count: number | null; delivered_count: number | null; late_count: number | null; revenue: number | null; completion_rate: number | null;
  }[]>`
    select d.id, d.code, d.name, d.name_kana, d.phone, d.employment_type, d.status, o.name office_name, v.plate_number,
           a.order_count, a.delivered_count, a.late_count, a.revenue, a.completion_rate
      from drivers d
      left join offices o on o.id = d.office_id
      left join vehicle_assignments va on va.driver_id = d.id and va.end_on is null
      left join vehicles v on v.id = va.vehicle_id
      left join analytics_by_driver(${startOfMonth(today)}::date, ${today}::date) a on a.driver_id = d.id
     where true
       ${like ? tx`and (d.name || ' ' || coalesce(d.name_kana, '') || ' ' || d.code || ' ' || coalesce(d.phone, '')) ilike ${like}` : tx``}
       ${f.status ? tx`and d.status = ${f.status}` : tx``}
       ${f.employment ? tx`and d.employment_type = ${f.employment}` : tx``}
     order by case d.status when 'retired' then 1 else 0 end, d.code`;
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, nameKana: r.name_kana, phone: r.phone, employmentType: r.employment_type,
    status: r.status, officeName: r.office_name, vehiclePlate: r.plate_number,
    monthDelivered: r.delivered_count ?? 0, monthOrders: r.order_count ?? 0, monthLate: r.late_count ?? 0,
    monthRevenue: r.revenue ?? 0, completionRate: r.completion_rate,
  }));
}

export type DriverDetail = {
  id: string;
  code: string;
  name: string;
  nameKana: string | null;
  phone: string | null;
  email: string | null;
  officeId: string | null;
  officeName: string | null;
  employmentType: EmploymentType;
  status: DriverStatus;
  hiredOn: string;
  notes: string | null;
  vehicle: { id: string; plate: string; type: string; since: string } | null;
  hasLogin: boolean;
  activeOrders: number;
  month: { orders: number; delivered: number; late: number; revenue: number; completionRate: number | null };
  series: { bucket: string; revenue: number; orders: number; delivered: number; late: number }[];
  /** 本日（日本時間）の担当案件。集荷予定の早い順 */
  today: { id: string; orderNo: string; deliveryName: string; clientName: string; pickupAt: Date; deliveryAt: Date; status: OrderStatus; isLate: boolean; fee: number }[];
  /** 配送履歴（前日まで、新しい順） */
  recent: { id: string; orderNo: string; deliveryName: string; clientName: string; deliveryAt: Date; status: OrderStatus; isLate: boolean; fee: number }[];
};

export async function getDriverDetail(tx: Tx, id: string, today: DateString): Promise<DriverDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [d] = await tx<{
    id: string; code: string; name: string; name_kana: string | null; phone: string | null; email: string | null; office_id: string | null;
    office_name: string | null; employment_type: EmploymentType; status: DriverStatus; hired_on: string; notes: string | null;
    vehicle_id: string | null; plate_number: string | null; vehicle_type: string | null; start_on: string | null; has_login: boolean; active_orders: number;
  }[]>`
    select d.*, o.name office_name, v.id vehicle_id, v.plate_number, v.vehicle_type, va.start_on,
           exists (select 1 from profiles p where p.driver_id = d.id) has_login,
           (select count(*) from delivery_orders x where x.driver_id = d.id and x.status in ('assigned','picked_up','in_transit')) active_orders
      from drivers d
      left join offices o on o.id = d.office_id
      left join vehicle_assignments va on va.driver_id = d.id and va.end_on is null
      left join vehicles v on v.id = va.vehicle_id
     where d.id = ${id}`;
  if (!d) return null;
  const from6 = startOfMonth(addMonths(today, -5));
  const [[month], series, todayRows, recent] = await Promise.all([
    tx<{ order_count: number; delivered_count: number; late_count: number; revenue: number; completion_rate: number | null }[]>`
      select order_count, delivered_count, late_count, revenue, completion_rate
        from analytics_by_driver(${startOfMonth(today)}::date, ${today}::date) where driver_id = ${id}`,
    tx<{ bucket: string; revenue: number; order_count: number; delivered_count: number; late_count: number }[]>`
      select * from analytics_order_series(${from6}::date, ${today}::date, 'month', null, ${id})`,
    tx<{ id: string; order_no: string; delivery_name: string; client_name: string; pickup_at: Date; delivery_at: Date; status: OrderStatus; is_late: boolean; fee: number }[]>`
      select o.id, o.order_no, o.delivery_name, c.name client_name, o.pickup_at, o.delivery_at, o.status, f.is_late, o.fee
        from delivery_orders o join v_order_facts f on f.id = o.id join clients c on c.id = o.client_id
       where o.driver_id = ${id}
         and o.delivery_at >= app.jst_start(${today}::date) and o.delivery_at < app.jst_start(${today}::date + 1)
       order by o.pickup_at, o.order_no`,
    tx<{ id: string; order_no: string; delivery_name: string; client_name: string; delivery_at: Date; status: OrderStatus; is_late: boolean; fee: number }[]>`
      select o.id, o.order_no, o.delivery_name, c.name client_name, o.delivery_at, o.status, f.is_late, o.fee
        from delivery_orders o join v_order_facts f on f.id = o.id join clients c on c.id = o.client_id
       where o.driver_id = ${id} and o.delivery_at < app.jst_start(${today}::date)
       order by o.delivery_at desc limit 8`,
  ]);
  return {
    id: d.id, code: d.code, name: d.name, nameKana: d.name_kana, phone: d.phone, email: d.email, officeId: d.office_id,
    officeName: d.office_name, employmentType: d.employment_type, status: d.status, hiredOn: toDateString(d.hired_on), notes: d.notes,
    vehicle: d.vehicle_id ? { id: d.vehicle_id, plate: d.plate_number!, type: d.vehicle_type!, since: toDateString(d.start_on!) } : null,
    hasLogin: d.has_login,
    activeOrders: d.active_orders,
    month: {
      orders: month?.order_count ?? 0, delivered: month?.delivered_count ?? 0, late: month?.late_count ?? 0,
      revenue: month?.revenue ?? 0, completionRate: month?.completion_rate ?? null,
    },
    series: series.map((s) => ({ bucket: toDateString(s.bucket), revenue: s.revenue, orders: s.order_count, delivered: s.delivered_count, late: s.late_count })),
    today: todayRows.map((r) => ({
      id: r.id, orderNo: r.order_no, deliveryName: r.delivery_name, clientName: r.client_name, pickupAt: r.pickup_at, deliveryAt: r.delivery_at,
      status: r.status, isLate: r.is_late, fee: r.fee,
    })),
    recent: recent.map((r) => ({
      id: r.id, orderNo: r.order_no, deliveryName: r.delivery_name, clientName: r.client_name, deliveryAt: r.delivery_at,
      status: r.status, isLate: r.is_late, fee: r.fee,
    })),
  };
}

export async function getOffices(tx: Tx) {
  return tx<{ id: string; name: string }[]>`select id, name from offices order by created_at, name`;
}

/** 担当車両を選ぶときの候補（廃車以外。他のドライバーが担当中なら、その名前も返す） */
export async function getVehicleChoices(tx: Tx) {
  return tx<{ id: string; plate_number: string; vehicle_type: string; status: string; driver_id: string | null; driver_name: string | null }[]>`
    select v.id, v.plate_number, v.vehicle_type, v.status, d.id driver_id, d.name driver_name
      from vehicles v
      left join vehicle_assignments va on va.vehicle_id = v.id and va.end_on is null
      left join drivers d on d.id = va.driver_id
     where v.status <> 'retired'
     order by v.code`;
}
