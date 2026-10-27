import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { addDays, isDateString, type DateString } from "@/lib/date";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/domain/status";

/**
 * ドライバー画面のデータ。asDriver() の中で呼ぶため、RLS により自分の担当案件しか取得できない。
 */

export type DriverOrderCard = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  pickupAt: Date;
  deliveryAt: Date;
  completedAt: Date | null;
  clientName: string;
  pickupAddress: string;
  deliveryName: string;
  deliveryAddress: string;
  cargoType: string;
  quantity: number;
  notes: string | null;
  isLate: boolean;
};

type CardRow = {
  id: string; order_no: string; status: OrderStatus; pickup_at: Date; delivery_at: Date; completed_at: Date | null;
  client_name: string; pickup_address: string; delivery_name: string; delivery_address: string; cargo_type: string;
  quantity: number; notes: string | null; is_late: boolean;
};

const toCard = (r: CardRow): DriverOrderCard => ({
  id: r.id, orderNo: r.order_no, status: r.status, pickupAt: r.pickup_at, deliveryAt: r.delivery_at, completedAt: r.completed_at,
  clientName: r.client_name, pickupAddress: r.pickup_address, deliveryName: r.delivery_name, deliveryAddress: r.delivery_address,
  cargoType: r.cargo_type, quantity: r.quantity, notes: r.notes, isLate: r.is_late,
});

function cardSelect(tx: Tx) {
  return tx`
    select o.id, o.order_no, o.status, o.pickup_at, o.delivery_at, o.completed_at, c.name client_name, o.pickup_address,
           o.delivery_name, o.delivery_address, o.cargo_type, o.quantity, o.notes, f.is_late
      from delivery_orders o
      join v_order_facts f on f.id = o.id
      join clients c on c.id = o.client_id`;
}

/** 指定日の担当案件（キャンセル以外・集荷予定順） */
export async function getDriverDay(tx: Tx, day: DateString): Promise<DriverOrderCard[]> {
  const rows = await tx<CardRow[]>`
    ${cardSelect(tx)}
     where o.delivery_at >= app.jst_start(${day}::date) and o.delivery_at < app.jst_start(${day}::date + 1)
       and o.status <> 'cancelled'
     order by o.pickup_at, o.order_no`;
  return rows.map(toCard);
}

/** 明日以降の予定（配車済のみ・直近） */
export async function getDriverUpcoming(tx: Tx, day: DateString, limit = 10): Promise<DriverOrderCard[]> {
  const rows = await tx<CardRow[]>`
    ${cardSelect(tx)}
     where o.delivery_at >= app.jst_start(${addDays(day, 1)}::date) and o.status = 'assigned'
     order by o.pickup_at, o.order_no
     limit ${limit}`;
  return rows.map(toCard);
}

/** 今月の実績（完了件数・失敗件数） */
export async function getDriverMonthStats(tx: Tx, day: DateString) {
  const [row] = await tx<{ delivered: number; failed: number; late: number }[]>`
    select count(*) filter (where f.status = 'delivered') delivered,
           count(*) filter (where f.status = 'failed') failed,
           count(*) filter (where f.status = 'delivered' and f.is_late) late
      from v_order_facts f
     where f.service_date between date_trunc('month', ${day}::date)::date and ${day}::date`;
  return row;
}

export type DriverOrderDetail = DriverOrderCard & {
  clientPhone: string | null;
  clientContact: string | null;
  vehiclePlate: string | null;
  logs: { id: string; from: OrderStatus | null; to: OrderStatus; by: string | null; note: string | null; at: Date }[];
  memos: { id: string; author: string; body: string; at: Date }[];
};

export async function getDriverOrder(tx: Tx, id: string): Promise<DriverOrderDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await tx<(CardRow & { client_phone: string | null; client_contact: string | null; plate_number: string | null })[]>`
    select o.id, o.order_no, o.status, o.pickup_at, o.delivery_at, o.completed_at, c.name client_name, o.pickup_address,
           o.delivery_name, o.delivery_address, o.cargo_type, o.quantity, o.notes, f.is_late,
           c.phone client_phone, c.contact_name client_contact, v.plate_number
      from delivery_orders o
      join v_order_facts f on f.id = o.id
      join clients c on c.id = o.client_id
      left join vehicles v on v.id = o.vehicle_id
     where o.id = ${id}`;
  if (!row) return null;
  const [logs, memos] = await Promise.all([
    tx<{ id: string; from_status: OrderStatus | null; to_status: OrderStatus; changed_by_name: string | null; note: string | null; created_at: Date }[]>`
      select id, from_status, to_status, changed_by_name, note, created_at from delivery_status_logs
       where order_id = ${id} order by created_at, id`,
    tx<{ id: string; author_name: string; body: string; created_at: Date }[]>`
      select id, author_name, body, created_at from delivery_notes where order_id = ${id} order by created_at desc`,
  ]);
  return {
    ...toCard(row),
    clientPhone: row.client_phone,
    clientContact: row.client_contact,
    vehiclePlate: row.plate_number,
    logs: logs.map((l) => ({ id: l.id, from: l.from_status, to: l.to_status, by: l.changed_by_name, note: l.note, at: l.created_at })),
    memos: memos.map((m) => ({ id: m.id, author: m.author_name, body: m.body, at: m.created_at })),
  };
}

export const HISTORY_PAGE_SIZE = 20;

const historySchema = z.object({
  from: z.string().refine(isDateString).optional().catch(undefined),
  to: z.string().refine(isDateString).optional().catch(undefined),
  status: z.enum(ORDER_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type HistoryFilters = z.infer<typeof historySchema>;

export function parseHistoryFilters(params: Record<string, string | string[] | undefined>): HistoryFilters {
  const flat = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== "" && v !== undefined),
  );
  return historySchema.parse(flat);
}

/** 配送履歴（今日までの担当案件・新しい順・ページ送り） */
export async function getDriverHistory(tx: Tx, today: DateString, f: HistoryFilters) {
  const page = f.page ?? 1;
  const from = f.from ?? addDays(today, -30);
  const to = f.to && f.to < today ? f.to : today;
  const where = tx`
    o.delivery_at >= app.jst_start(${from}::date) and o.delivery_at < app.jst_start(${to}::date + 1)
    ${f.status ? tx`and o.status = ${f.status}` : tx``}`;
  const [rows, [count]] = await Promise.all([
    tx<CardRow[]>`
      ${cardSelect(tx)}
       where ${where}
       order by o.delivery_at desc, o.order_no desc
       limit ${HISTORY_PAGE_SIZE} offset ${(page - 1) * HISTORY_PAGE_SIZE}`,
    tx<{ n: number; delivered: number }[]>`
      select count(*) n, count(*) filter (where o.status = 'delivered') delivered from delivery_orders o where ${where}`,
  ]);
  return {
    rows: rows.map(toCard),
    total: count.n,
    delivered: count.delivered,
    page,
    pageCount: Math.max(1, Math.ceil(count.n / HISTORY_PAGE_SIZE)),
    from,
    to,
  };
}
