import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { addMonths, daysBetween, startOfMonth, type DateString } from "@/lib/date";
import { VEHICLE_STATUSES, type ExpenseCategory, type VehicleStatus } from "@/lib/domain/labels";
import { DEADLINE_WARNING_DAYS } from "@/lib/domain/deadline";
import { toDateString } from "./dashboard";

export { DEADLINE_WARNING_DAYS };

const filterSchema = z.object({
  q: z.string().trim().max(50).optional().catch(undefined),
  status: z.enum(VEHICLE_STATUSES).optional().catch(undefined),
  due: z.literal("1").optional().catch(undefined),
});
export type VehicleFilters = z.infer<typeof filterSchema>;

export function parseVehicleFilters(params: Record<string, string | string[] | undefined>): VehicleFilters {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v));
  return filterSchema.parse(flat);
}

export type VehicleRow = {
  id: string;
  code: string;
  plate: string;
  type: string;
  maker: string;
  model: string | null;
  status: VehicleStatus;
  driverId: string | null;
  driverName: string | null;
  inspection: string;
  insurance: string;
  inspectionDays: number;
  insuranceDays: number;
  monthOrders: number;
};

export function listVehicles(tx: Tx, f: VehicleFilters, today: DateString): Promise<VehicleRow[]> {
  return queryVehicles(tx, f, today);
}

async function queryVehicles(tx: Tx, f: VehicleFilters, today: DateString, id?: string): Promise<VehicleRow[]> {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const rows = await tx<{
    id: string; code: string; plate_number: string; vehicle_type: string; maker: string; model: string | null; status: VehicleStatus;
    driver_id: string | null; driver_name: string | null; inspection_expires_on: string; insurance_expires_on: string; month_orders: number;
  }[]>`
    select v.id, v.code, v.plate_number, v.vehicle_type, v.maker, v.model, v.status, d.id driver_id, d.name driver_name,
           v.inspection_expires_on, v.insurance_expires_on,
           (select count(*) from delivery_orders o
             where o.vehicle_id = v.id and o.status <> 'cancelled'
               and o.delivery_at >= app.jst_start(${startOfMonth(today)}::date) and o.delivery_at < app.jst_start(${today}::date + 1)) month_orders
      from vehicles v
      left join vehicle_assignments va on va.vehicle_id = v.id and va.end_on is null
      left join drivers d on d.id = va.driver_id
     where true
       ${id ? tx`and v.id = ${id}` : tx``}
       ${like ? tx`and (v.plate_number || ' ' || v.code || ' ' || v.vehicle_type || ' ' || v.maker || ' ' || coalesce(d.name, '')) ilike ${like}` : tx``}
       ${f.status ? tx`and v.status = ${f.status}` : tx``}
       ${f.due ? tx`and v.status <> 'retired' and least(v.inspection_expires_on, v.insurance_expires_on) <= ${today}::date + ${DEADLINE_WARNING_DAYS}::int` : tx``}
     order by case v.status when 'retired' then 1 else 0 end, v.code`;
  return rows.map((r) => {
    const inspection = toDateString(r.inspection_expires_on);
    const insurance = toDateString(r.insurance_expires_on);
    return {
      id: r.id, code: r.code, plate: r.plate_number, type: r.vehicle_type, maker: r.maker, model: r.model, status: r.status,
      driverId: r.driver_id, driverName: r.driver_name, inspection, insurance,
      inspectionDays: daysBetween(today, inspection), insuranceDays: daysBetween(today, insurance), monthOrders: r.month_orders,
    };
  });
}

export type VehicleDetail = VehicleRow & {
  capacityKg: number | null;
  notes: string | null;
  activeOrders: number;
  assignments: { id: string; driverId: string; driverName: string; startOn: string; endOn: string | null }[];
  expenses: { id: string; spentOn: string; category: ExpenseCategory; amount: number; description: string | null }[];
  expenseTotal6m: number;
};

export async function getVehicleDetail(tx: Tx, id: string, today: DateString): Promise<VehicleDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await queryVehicles(tx, {}, today, id);
  if (!row) return null;
  const from6 = startOfMonth(addMonths(today, -5));
  const [[v], assignments, expenses, [total], [active]] = await Promise.all([
    tx<{ capacity_kg: number | null; notes: string | null }[]>`select capacity_kg, notes from vehicles where id = ${id}`,
    tx<{ id: string; driver_id: string; driver_name: string; start_on: string; end_on: string | null }[]>`
      select va.id, va.driver_id, d.name driver_name, va.start_on, va.end_on
        from vehicle_assignments va join drivers d on d.id = va.driver_id
       where va.vehicle_id = ${id} order by va.start_on desc, va.created_at desc limit 10`,
    tx<{ id: string; spent_on: string; category: ExpenseCategory; amount: number; description: string | null }[]>`
      select id, spent_on, category, amount, description from expenses
       where vehicle_id = ${id} order by spent_on desc, created_at desc limit 10`,
    tx<{ amount: number }[]>`
      select coalesce(sum(amount), 0) amount from expenses where vehicle_id = ${id} and spent_on between ${from6}::date and ${today}::date`,
    tx<{ n: number }[]>`select count(*) n from delivery_orders where vehicle_id = ${id} and status in ('assigned','picked_up','in_transit')`,
  ]);
  return {
    ...row,
    capacityKg: v.capacity_kg,
    notes: v.notes,
    activeOrders: active.n,
    assignments: assignments.map((a) => ({
      id: a.id, driverId: a.driver_id, driverName: a.driver_name, startOn: toDateString(a.start_on), endOn: a.end_on ? toDateString(a.end_on) : null,
    })),
    expenses: expenses.map((e) => ({ id: e.id, spentOn: toDateString(e.spent_on), category: e.category, amount: e.amount, description: e.description })),
    expenseTotal6m: total.amount,
  };
}

/** 担当ドライバーを選ぶときの候補（退職者以外。別の車両を担当中なら、その車両番号も返す） */
export async function getDriverChoices(tx: Tx) {
  return tx<{ id: string; name: string; status: string; vehicle_id: string | null; plate_number: string | null }[]>`
    select d.id, d.name, d.status, v.id vehicle_id, v.plate_number
      from drivers d
      left join vehicle_assignments va on va.driver_id = d.id and va.end_on is null
      left join vehicles v on v.id = va.vehicle_id
     where d.status <> 'retired'
     order by d.code`;
}
