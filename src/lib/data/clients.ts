import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { addMonths, endOfMonth, jstDateTime, startOfMonth, type DateString } from "@/lib/date";
import type { OrderStatus } from "@/lib/domain/status";
import { toDateString } from "./dashboard";

const filterSchema = z.object({ q: z.string().trim().max(50).optional().catch(undefined) });
export type ClientFilters = z.infer<typeof filterSchema>;

export function parseClientFilters(params: Record<string, string | string[] | undefined>): ClientFilters {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  return filterSchema.parse(flat);
}

/** 今月1日 0:00（日本時間）。これより前の配送予定日の月は締め済み */
function monthStartAt(today: DateString): Date {
  return jstDateTime(startOfMonth(today));
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
  /** 配送完了・未請求の料金（今月の締め前の分を含む）と、そのうち締め済みの月の分 */
  unbilled: number;
  unbilledClosed: number;
};

export async function listClients(tx: Tx, f: ClientFilters, today: DateString): Promise<ClientRow[]> {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const prevStart = startOfMonth(addMonths(today, -1));
  const rows = await tx<{
    id: string; code: string; name: string; contact_name: string | null; phone: string | null; started_on: string | null;
    revenue: number | null; order_count: number | null; prev_revenue: number | null; unbilled: number | null; unbilled_closed: number | null;
  }[]>`
    select c.id, c.code, c.name, c.contact_name, c.phone, c.started_on, a.revenue, a.order_count, p.revenue prev_revenue,
           u.unbilled, u.unbilled_closed
      from clients c
      left join analytics_by_client(${startOfMonth(today)}::date, ${today}::date) a on a.client_id = c.id
      left join analytics_by_client(${prevStart}::date, ${endOfMonth(prevStart)}::date) p on p.client_id = c.id
      left join (
        select o.client_id, sum(o.fee) unbilled,
               coalesce(sum(o.fee) filter (where o.delivery_at < ${monthStartAt(today)}), 0) unbilled_closed
          from delivery_orders o
         where o.status = 'delivered' and o.invoice_id is null
         group by o.client_id
      ) u on u.client_id = c.id
     where true
       ${like ? tx`and (c.name || ' ' || c.code || ' ' || coalesce(c.contact_name, '') || ' ' || coalesce(c.phone, '')) ilike ${like}` : tx``}
     order by coalesce(a.revenue, 0) desc, c.code`;
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, contactName: r.contact_name, phone: r.phone,
    startedOn: r.started_on ? toDateString(r.started_on) : null,
    monthRevenue: r.revenue ?? 0, monthOrders: r.order_count ?? 0, prevMonthRevenue: r.prev_revenue ?? 0,
    unbilled: r.unbilled ?? 0, unbilledClosed: r.unbilled_closed ?? 0,
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

export type BillingInvoice = {
  id: string; invoiceNo: string; issuedOn: string; orderCount: number; amount: number; notes: string | null;
  /** 取り消した請求は履歴に残す（金額の合計には含めない） */
  cancelledAt: Date | null;
};

export type BillingMonth = {
  /** 対象月の1日 */
  month: DateString;
  /** 締め済み（前月以前）か */
  closed: boolean;
  /** キャンセルを除く件数・配送完了の件数・売上（配送完了分の料金。売上分析と同じ定義） */
  orders: number;
  delivered: number;
  revenue: number;
  /** 配送完了・未請求の料金と件数 */
  unbilled: number;
  unbilledCount: number;
  invoices: BillingInvoice[];
};

export type ClientBilling = {
  months: BillingMonth[];
  /** 未請求の合計（今月の締め前を含む）と、そのうち締め済みの月の分 */
  unbilled: number;
  unbilledClosed: number;
  invoicedTotal: number;
};

/**
 * 荷主の請求・取引履歴（月ごと、新しい順）。
 * 直近6か月（今月を含む）に加え、それより前でも未請求が残っている月を出す。
 * 売上 = 請求済み（発行時の金額）＋ 未請求。請求済みの案件は料金を変えられないため常に一致する。
 */
export async function getClientBilling(tx: Tx, clientId: string, today: DateString): Promise<ClientBilling> {
  const thisMonth = startOfMonth(today);
  const from6 = startOfMonth(addMonths(today, -5));
  const [rows, invoices] = await Promise.all([
    tx<{ month: string; order_count: number; delivered_count: number; revenue: number; unbilled: number; unbilled_count: number }[]>`
      select date_trunc('month', o.delivery_at at time zone 'Asia/Tokyo')::date as month,
             count(*) filter (where o.status <> 'cancelled')::int order_count,
             count(*) filter (where o.status = 'delivered')::int delivered_count,
             coalesce(sum(o.fee) filter (where o.status = 'delivered'), 0) revenue,
             coalesce(sum(o.fee) filter (where o.status = 'delivered' and o.invoice_id is null), 0) unbilled,
             count(*) filter (where o.status = 'delivered' and o.invoice_id is null)::int unbilled_count
        from delivery_orders o
       where o.client_id = ${clientId}
       group by 1
      having date_trunc('month', o.delivery_at at time zone 'Asia/Tokyo')::date between ${from6}::date and ${thisMonth}::date
          or count(*) filter (where o.status = 'delivered' and o.invoice_id is null) > 0`,
    tx<{ id: string; invoice_no: string; period_start: string; issued_on: string; order_count: number; amount: number; notes: string | null; cancelled_at: Date | null }[]>`
      select id, invoice_no, period_start, issued_on, order_count, amount, notes, cancelled_at from client_invoices
       where client_id = ${clientId}
       order by period_start desc, invoice_no`,
  ]);

  const byMonth = new Map<string, BillingMonth>();
  const ensure = (month: DateString) => {
    let m = byMonth.get(month);
    if (!m) {
      m = { month, closed: month < thisMonth, orders: 0, delivered: 0, revenue: 0, unbilled: 0, unbilledCount: 0, invoices: [] };
      byMonth.set(month, m);
    }
    return m;
  };
  for (let m = thisMonth; m >= from6; m = addMonths(m, -1)) ensure(m);
  for (const r of rows) {
    Object.assign(ensure(toDateString(r.month)), {
      orders: r.order_count, delivered: r.delivered_count, revenue: r.revenue, unbilled: r.unbilled, unbilledCount: r.unbilled_count,
    });
  }
  for (const i of invoices) {
    const month = toDateString(i.period_start);
    // 表示する月の請求だけ（古い月は未請求が残っているときだけ表示する）
    byMonth.get(month)?.invoices.push({
      id: i.id, invoiceNo: i.invoice_no, issuedOn: toDateString(i.issued_on), orderCount: i.order_count, amount: i.amount, notes: i.notes,
      cancelledAt: i.cancelled_at,
    });
  }
  const months = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
  return {
    months,
    unbilled: rows.reduce((s, r) => s + r.unbilled, 0),
    unbilledClosed: rows.filter((r) => toDateString(r.month) < thisMonth).reduce((s, r) => s + r.unbilled, 0),
    invoicedTotal: invoices.filter((i) => !i.cancelled_at).reduce((s, i) => s + i.amount, 0),
  };
}
