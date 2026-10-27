import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { addDays, isDateString, todayJst } from "@/lib/date";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/domain/status";

export const PAGE_SIZE = 20;

const SORTS = ["delivery_at", "pickup_at", "order_no", "fee", "status", "created_at", "updated_at"] as const;
export type OrderSort = (typeof SORTS)[number];

const filterSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  from: z.string().refine(isDateString).optional().catch(undefined),
  to: z.string().refine(isDateString).optional().catch(undefined),
  client: z.uuid().optional().catch(undefined),
  driver: z.union([z.uuid(), z.literal("none")]).optional().catch(undefined),
  status: z.enum(ORDER_STATUSES).optional().catch(undefined),
  late: z.literal("1").optional().catch(undefined),
  scope: z.enum(["active"]).optional().catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});

export type OrderFilters = z.infer<typeof filterSchema>;

/** URL のクエリを検証して検索条件にする（不正な値は無視） */
export function parseOrderFilters(params: Record<string, string | string[] | undefined>): OrderFilters {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== "" && v !== undefined));
  return filterSchema.parse(flat);
}

export type OrderListRow = {
  id: string;
  orderNo: string;
  clientId: string;
  clientName: string;
  deliveryName: string;
  deliveryAddress: string;
  pickupAt: Date;
  deliveryAt: Date;
  driverId: string | null;
  driverName: string | null;
  vehiclePlate: string | null;
  cargoType: string;
  quantity: number;
  fee: number;
  status: OrderStatus;
  isLate: boolean;
  completedAt: Date | null;
};

function whereClause(tx: Tx, f: OrderFilters) {
  const conds = [tx`true`];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conds.push(tx`(o.order_no || ' ' || o.delivery_name || ' ' || o.delivery_address) ilike ${like}`);
  }
  if (f.from) conds.push(tx`o.delivery_at >= app.jst_start(${f.from}::date)`);
  if (f.to) conds.push(tx`o.delivery_at < app.jst_start(${f.to}::date + 1)`);
  if (f.client) conds.push(tx`o.client_id = ${f.client}`);
  if (f.driver === "none") conds.push(tx`o.driver_id is null`);
  else if (f.driver) conds.push(tx`o.driver_id = ${f.driver}`);
  if (f.status) conds.push(tx`o.status = ${f.status}`);
  if (f.scope === "active") conds.push(tx`o.status in ('unassigned','assigned','picked_up','in_transit')`);
  if (f.late) conds.push(tx`f.is_late`);
  return conds.reduce((acc, c) => tx`${acc} and ${c}`);
}

export async function listOrders(tx: Tx, f: OrderFilters) {
  const page = f.page ?? 1;
  const sort = f.sort ?? "delivery_at";
  const dir = f.dir ?? (f.sort ? "asc" : "desc");
  const where = whereClause(tx, f);
  const order = tx.unsafe(`o.${sort} ${dir === "asc" ? "asc" : "desc"}, o.order_no ${dir === "asc" ? "asc" : "desc"}`);
  const [rows, [count]] = await Promise.all([
    tx<{
      id: string; order_no: string; client_id: string; client_name: string; delivery_name: string; delivery_address: string;
      pickup_at: Date; delivery_at: Date; driver_id: string | null; driver_name: string | null; plate_number: string | null;
      cargo_type: string; quantity: number; fee: number; status: OrderStatus; is_late: boolean; completed_at: Date | null;
    }[]>`
      select o.id, o.order_no, o.client_id, c.name client_name, o.delivery_name, o.delivery_address,
             o.pickup_at, o.delivery_at, o.driver_id, d.name driver_name, v.plate_number,
             o.cargo_type, o.quantity, o.fee, o.status, f.is_late, o.completed_at
        from delivery_orders o
        join v_order_facts f on f.id = o.id
        join clients c on c.id = o.client_id
        left join drivers d on d.id = o.driver_id
        left join vehicles v on v.id = o.vehicle_id
       where ${where}
       order by ${order}
       limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
    tx<{ n: number; fee: number }[]>`
      select count(*) n, coalesce(sum(o.fee) filter (where o.status = 'delivered'), 0) fee
        from delivery_orders o join v_order_facts f on f.id = o.id
       where ${where}`,
  ]);
  return {
    rows: rows.map<OrderListRow>((r) => ({
      id: r.id, orderNo: r.order_no, clientId: r.client_id, clientName: r.client_name, deliveryName: r.delivery_name,
      deliveryAddress: r.delivery_address, pickupAt: r.pickup_at, deliveryAt: r.delivery_at, driverId: r.driver_id,
      driverName: r.driver_name, vehiclePlate: r.plate_number, cargoType: r.cargo_type, quantity: r.quantity, fee: r.fee,
      status: r.status, isLate: r.is_late, completedAt: r.completed_at,
    })),
    total: count.n,
    deliveredFee: count.fee,
    page,
    pageCount: Math.max(1, Math.ceil(count.n / PAGE_SIZE)),
  };
}

export type FormOptions = {
  clients: { id: string; name: string; address: string | null }[];
  drivers: { id: string; name: string; status: string; vehicleId: string | null; employmentType: string }[];
  vehicles: { id: string; plate: string; type: string; status: string }[];
};

export async function getFormOptions(tx: Tx): Promise<FormOptions> {
  const [clients, drivers, vehicles] = await Promise.all([
    tx<{ id: string; name: string; address: string | null }[]>`select id, name, address from clients order by code`,
    tx<{ id: string; name: string; status: string; vehicle_id: string | null; employment_type: string }[]>`
      select d.id, d.name, d.status, va.vehicle_id, d.employment_type from drivers d
        left join vehicle_assignments va on va.driver_id = d.id and va.end_on is null
       where d.status <> 'retired' order by d.code`,
    tx<{ id: string; plate_number: string; vehicle_type: string; status: string }[]>`
      select id, plate_number, vehicle_type, status from vehicles where status <> 'retired' order by code`,
  ]);
  return {
    clients,
    drivers: drivers.map((d) => ({ id: d.id, name: d.name, status: d.status, vehicleId: d.vehicle_id, employmentType: d.employment_type })),
    vehicles: vehicles.map((v) => ({ id: v.id, plate: v.plate_number, type: v.vehicle_type, status: v.status })),
  };
}

export type OrderDetail = OrderListRow & {
  clientPhone: string | null;
  clientContact: string | null;
  pickupAddress: string;
  deliveryLat: number | null;
  deliveryLng: number | null;
  vehicleId: string | null;
  vehicleType: string | null;
  driverPhone: string | null;
  notes: string | null;
  invoiced: boolean;
  /** 請求済みなら請求番号（請求済みの案件は料金・荷主・配送日を変更できない） */
  invoiceNo: string | null;
  invoiceIssuedOn: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** 同時編集の検知に使う更新の印（updated_at をマイクロ秒まで含めた文字列） */
  version: string;
  logs: { id: string; from: OrderStatus | null; to: OrderStatus; by: string | null; note: string | null; at: Date }[];
  memos: { id: string; author: string; body: string; at: Date }[];
};

/** 案件の更新の印（編集を開いた後に誰かが更新したかを、保存のときに確かめる） */
export function orderVersion(tx: Tx) {
  return tx`(extract(epoch from o.updated_at) * 1000000)::bigint::text`;
}

export async function getOrderDetail(tx: Tx, id: string): Promise<OrderDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [o] = await tx<Record<string, never>[]>`
    select o.*, c.name client_name, c.phone client_phone, c.contact_name client_contact,
           d.name driver_name, d.phone driver_phone, v.plate_number, v.vehicle_type, f.is_late,
           ci.invoice_no, ci.issued_on invoice_issued_on, ${orderVersion(tx)} version
      from delivery_orders o
      join v_order_facts f on f.id = o.id
      join clients c on c.id = o.client_id
      left join drivers d on d.id = o.driver_id
      left join vehicles v on v.id = o.vehicle_id
      left join client_invoices ci on ci.id = o.invoice_id
     where o.id = ${id}`;
  if (!o) return null;
  const [logs, memos] = await Promise.all([
    tx<{ id: string; from_status: OrderStatus | null; to_status: OrderStatus; changed_by_name: string | null; note: string | null; created_at: Date }[]>`
      select id, from_status, to_status, changed_by_name, note, created_at from delivery_status_logs
       where order_id = ${id} order by created_at, id`,
    tx<{ id: string; author_name: string; body: string; created_at: Date }[]>`
      select id, author_name, body, created_at from delivery_notes where order_id = ${id} order by created_at desc`,
  ]);
  const r = o as unknown as Record<string, unknown>;
  return {
    id: r.id as string,
    orderNo: r.order_no as string,
    clientId: r.client_id as string,
    clientName: r.client_name as string,
    clientPhone: r.client_phone as string | null,
    clientContact: r.client_contact as string | null,
    pickupAddress: r.pickup_address as string,
    deliveryName: r.delivery_name as string,
    deliveryAddress: r.delivery_address as string,
    deliveryLat: r.delivery_lat as number | null,
    deliveryLng: r.delivery_lng as number | null,
    pickupAt: r.pickup_at as Date,
    deliveryAt: r.delivery_at as Date,
    driverId: r.driver_id as string | null,
    driverName: r.driver_name as string | null,
    driverPhone: r.driver_phone as string | null,
    vehicleId: r.vehicle_id as string | null,
    vehiclePlate: r.plate_number as string | null,
    vehicleType: r.vehicle_type as string | null,
    cargoType: r.cargo_type as string,
    quantity: r.quantity as number,
    fee: r.fee as number,
    status: r.status as OrderStatus,
    isLate: r.is_late as boolean,
    completedAt: r.completed_at as Date | null,
    notes: r.notes as string | null,
    invoiced: r.invoiced as boolean,
    invoiceNo: (r.invoice_no as string | null) ?? null,
    invoiceIssuedOn: r.invoice_issued_on ? String(r.invoice_issued_on).slice(0, 10) : null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    version: r.version as string,
    logs: logs.map((l) => ({ id: l.id, from: l.from_status, to: l.to_status, by: l.changed_by_name, note: l.note, at: l.created_at })),
    memos: memos.map((m) => ({ id: m.id, author: m.author_name, body: m.body, at: m.created_at })),
  };
}

/** 指定ドライバーの、時間帯が重なる有効な案件 */
export async function findDriverConflicts(tx: Tx, driverId: string, start: Date, end: Date, excludeId?: string) {
  return tx<{ id: string; order_no: string; delivery_name: string; pickup_at: Date; delivery_at: Date }[]>`
    select id, order_no, delivery_name, pickup_at, delivery_at from delivery_orders
     where driver_id = ${driverId}
       and status in ('assigned','picked_up','in_transit')
       and pickup_at < ${end} and delivery_at > ${start}
       ${excludeId ? tx`and id <> ${excludeId}` : tx``}
     order by pickup_at`;
}

export function defaultOrderRange() {
  const today = todayJst();
  return { from: addDays(today, -7), to: addDays(today, 7) };
}

/** CSV で書き出せる最大件数（これを超える場合は期間などで絞り込んでもらう） */
export const ORDER_EXPORT_LIMIT = 20_000;

export type OrderExportRow = {
  orderNo: string; clientCode: string; clientName: string; pickupAddress: string; deliveryName: string; deliveryAddress: string;
  pickupAt: Date; deliveryAt: Date; driverName: string | null; vehiclePlate: string | null; cargoType: string; quantity: number;
  fee: number; status: OrderStatus; isLate: boolean; completedAt: Date | null; invoiceNo: string | null; notes: string | null;
  createdAt: Date; updatedAt: Date;
};

/** 一覧と同じ検索条件で、CSV 用に全件（上限あり）を配送予定の古い順に取得する */
export async function exportOrders(tx: Tx, f: OrderFilters): Promise<{ rows: OrderExportRow[]; total: number }> {
  const where = whereClause(tx, f);
  const [[count], rows] = await Promise.all([
    tx<{ n: number }[]>`select count(*)::int n from delivery_orders o join v_order_facts f on f.id = o.id where ${where}`,
    tx<{
      order_no: string; client_code: string; client_name: string; pickup_address: string; delivery_name: string; delivery_address: string;
      pickup_at: Date; delivery_at: Date; driver_name: string | null; plate_number: string | null; cargo_type: string; quantity: number;
      fee: number; status: OrderStatus; is_late: boolean; completed_at: Date | null; invoice_no: string | null; notes: string | null;
      created_at: Date; updated_at: Date;
    }[]>`
      select o.order_no, c.code client_code, c.name client_name, o.pickup_address, o.delivery_name, o.delivery_address,
             o.pickup_at, o.delivery_at, d.name driver_name, v.plate_number, o.cargo_type, o.quantity, o.fee, o.status,
             f.is_late, o.completed_at, ci.invoice_no, o.notes, o.created_at, o.updated_at
        from delivery_orders o
        join v_order_facts f on f.id = o.id
        join clients c on c.id = o.client_id
        left join drivers d on d.id = o.driver_id
        left join vehicles v on v.id = o.vehicle_id
        left join client_invoices ci on ci.id = o.invoice_id
       where ${where}
       order by o.delivery_at, o.order_no
       limit ${ORDER_EXPORT_LIMIT}`,
  ]);
  return {
    total: count.n,
    rows: rows.map((r) => ({
      orderNo: r.order_no, clientCode: r.client_code, clientName: r.client_name, pickupAddress: r.pickup_address,
      deliveryName: r.delivery_name, deliveryAddress: r.delivery_address, pickupAt: r.pickup_at, deliveryAt: r.delivery_at,
      driverName: r.driver_name, vehiclePlate: r.plate_number, cargoType: r.cargo_type, quantity: r.quantity, fee: r.fee,
      status: r.status, isLate: r.is_late, completedAt: r.completed_at, invoiceNo: r.invoice_no, notes: r.notes,
      createdAt: r.created_at, updatedAt: r.updated_at,
    })),
  };
}
