import "server-only";
import type { Tx } from "@/lib/db";
import type { DateString } from "@/lib/date";
import type { OrderStatus } from "@/lib/domain/status";

export type BoardDriver = {
  id: string;
  name: string;
  status: "active" | "day_off" | "leave";
  employmentType: string;
  vehicleId: string | null;
  vehiclePlate: string | null;
  vehicleType: string | null;
};

export type BoardOrder = {
  id: string;
  orderNo: string;
  clientName: string;
  deliveryName: string;
  deliveryAddress: string;
  cargoType: string;
  quantity: number;
  fee: number;
  /** ISO 文字列（クライアントへそのまま渡す） */
  pickupAt: string;
  deliveryAt: string;
  driverId: string | null;
  vehiclePlate: string | null;
  status: OrderStatus;
  isLate: boolean;
};

/** 配車ボード：指定日の案件（キャンセル以外）とドライバー（退職者以外）。1日分なので全件取得する */
export async function getDispatchBoard(tx: Tx, day: DateString): Promise<{ drivers: BoardDriver[]; orders: BoardOrder[] }> {
  const [drivers, orders] = await Promise.all([
    tx<{
      id: string; name: string; status: BoardDriver["status"]; employment_type: string;
      vehicle_id: string | null; plate_number: string | null; vehicle_type: string | null;
    }[]>`
      select d.id, d.name, d.status, d.employment_type,
             v.id vehicle_id, v.plate_number, v.vehicle_type
        from drivers d
        left join vehicle_assignments va on va.driver_id = d.id and va.end_on is null
        left join vehicles v on v.id = va.vehicle_id
       where d.status <> 'retired'
       order by case d.status when 'active' then 0 when 'day_off' then 1 else 2 end, d.code`,
    tx<{
      id: string; order_no: string; client_name: string; delivery_name: string; delivery_address: string; cargo_type: string;
      quantity: number; fee: number; pickup_at: Date; delivery_at: Date; driver_id: string | null; plate_number: string | null;
      status: OrderStatus; is_late: boolean;
    }[]>`
      select o.id, o.order_no, c.name client_name, o.delivery_name, o.delivery_address, o.cargo_type, o.quantity, o.fee,
             o.pickup_at, o.delivery_at, o.driver_id, v.plate_number, o.status, f.is_late
        from delivery_orders o
        join v_order_facts f on f.id = o.id
        join clients c on c.id = o.client_id
        left join vehicles v on v.id = o.vehicle_id
       where o.pickup_at < app.jst_start(${day}::date + 1)
         and o.delivery_at >= app.jst_start(${day}::date)
         and o.status <> 'cancelled'
       order by o.pickup_at, o.order_no`,
  ]);
  return {
    drivers: drivers.map((d) => ({
      id: d.id, name: d.name, status: d.status, employmentType: d.employment_type,
      vehicleId: d.vehicle_id, vehiclePlate: d.plate_number, vehicleType: d.vehicle_type,
    })),
    orders: orders.map((o) => ({
      id: o.id, orderNo: o.order_no, clientName: o.client_name, deliveryName: o.delivery_name, deliveryAddress: o.delivery_address,
      cargoType: o.cargo_type, quantity: o.quantity, fee: o.fee, pickupAt: o.pickup_at.toISOString(), deliveryAt: o.delivery_at.toISOString(),
      driverId: o.driver_id, vehiclePlate: o.plate_number, status: o.status, isLate: o.is_late,
    })),
  };
}
