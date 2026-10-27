import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { addMonths, endOfMonth, startOfMonth, type DateString } from "@/lib/date";
import type { OrderStatus } from "@/lib/domain/status";
import { toDateString } from "./dashboard";

const filterSchema = z.object({ q: z.string().trim().max(50).optional().catch(undefined) });
export type ClientFilters = z.infer<typeof filterSchema>;

export function parseClientFilters(params: Record<string, string | string[] | undefined>): ClientFilters {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  return filterSchema.parse(flat);
}

export type ClientRow = {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  startedOn: string | null;
  /** 今月（1日〜本日）・前月の売上と件数。集計は analytics_by_client（売上分析と同じ関数） */
  monthRevenue: number;
  monthOrders: number;
  prevMonthRevenue: number;
};

export async function listClients(tx: Tx, f: ClientFilters, today: DateString): Promise<ClientRow[]> {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const prevStart = startOfMonth(addMonths(today, -1));
  const rows = await tx<{
    id: string; code: string; name: string; contact_name: string | null; phone: string | null; started_on: string | null;
    revenue: number | null; order_count: number | null; prev_revenue: number | null;
  }[]>`
    select c.id, c.code, c.name, c.contact_name, c.phone, c.started_on, a.revenue, a.order_count, p.revenue prev_revenue
      from clients c
      left join analytics_by_client(${startOfMonth(today)}::date, ${today}::date) a on a.client_id = c.id
      left join analytics_by_client(${prevStart}::date, ${endOfMonth(prevStart)}::date) p on p.client_id = c.id
     where true
       ${like ? tx`and (c.name || ' ' || c.code || ' ' || coalesce(c.contact_name, '') || ' ' || coalesce(c.phone, '')) ilike ${like}` : tx``}
     order by coalesce(a.revenue, 0) desc, c.code`;
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, contactName: r.contact_name, phone: r.phone,
    startedOn: r.started_on ? toDateString(r.started_on) : null,
    monthRevenue: r.revenue ?? 0, monthOrders: r.order_count ?? 0, prevMonthRevenue: r.prev_revenue ?? 0,
  }));
}

export type ClientDetail = {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  startedOn: string | null;
  notes: string | null;
  totalOrders: number;
  activeOrders: number;
  series: { bucket: string; revenue: number; orders: number; delivered: number; late: number }[];
  recent: { id: string; orderNo: string; deliveryName: string; driverName: string | null; deliveryAt: Date; status: OrderStatus; isLate: boolean; fee: number }[];
};

export async function getClientDetail(tx: Tx, id: string, today: DateString): Promise<ClientDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [c] = await tx<{
    id: string; code: string; name: string; contact_name: string | null; phone: string | null; email: string | null; address: string | null;
    started_on: string | null; notes: string | null; total_orders: number; active_orders: number;
  }[]>`
    select c.*, (select count(*) from delivery_orders o where o.client_id = c.id) total_orders,
           (select count(*) from delivery_orders o where o.client_id = c.id and o.status in ('unassigned','assigned','picked_up','in_transit')) active_orders
      from clients c where c.id = ${id}`;
  if (!c) return null;
  const from6 = startOfMonth(addMonths(today, -5));
  const [series, recent] = await Promise.all([
    tx<{ bucket: string; revenue: number; order_count: number; delivered_count: number; late_count: number }[]>`
      select * from analytics_order_series(${from6}::date, ${today}::date, 'month', ${id}, null)`,
    tx<{ id: string; order_no: string; delivery_name: string; driver_name: string | null; delivery_at: Date; status: OrderStatus; is_late: boolean; fee: number }[]>`
      select o.id, o.order_no, o.delivery_name, d.name driver_name, o.delivery_at, o.status, f.is_late, o.fee
        from delivery_orders o join v_order_facts f on f.id = o.id left join drivers d on d.id = o.driver_id
       where o.client_id = ${id}
       order by o.delivery_at desc limit 8`,
  ]);
  return {
    id: c.id, code: c.code, name: c.name, contactName: c.contact_name, phone: c.phone, email: c.email, address: c.address,
    startedOn: c.started_on ? toDateString(c.started_on) : null, notes: c.notes, totalOrders: c.total_orders, activeOrders: c.active_orders,
    series: series.map((s) => ({ bucket: toDateString(s.bucket), revenue: s.revenue, orders: s.order_count, delivered: s.delivered_count, late: s.late_count })),
    recent: recent.map((r) => ({
      id: r.id, orderNo: r.order_no, deliveryName: r.delivery_name, driverName: r.driver_name, deliveryAt: r.delivery_at,
      status: r.status, isLate: r.is_late, fee: r.fee,
    })),
  };
}
