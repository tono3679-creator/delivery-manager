import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import type { DateString } from "@/lib/date";
import { mapState, type MapState } from "@/lib/domain/map";
import type { OrderStatus } from "@/lib/domain/status";

export type MapOrder = {
  id: string;
  orderNo: string;
  state: MapState;
  status: OrderStatus;
  /** 遅れて完了した案件（完了なので緑だが、吹き出しで知らせる） */
  completedLate: boolean;
  clientName: string;
  driverId: string | null;
  driverName: string | null;
  deliveryName: string;
  deliveryAddress: string;
  /** デモ用の位置（住所から求めた近似の座標）。無い案件は地図に出さず件数だけ示す */
  lat: number | null;
  lng: number | null;
  /** ISO 文字列 */
  pickupAt: string;
  deliveryAt: string;
  completedAt: string | null;
};

/**
 * 指定日（配送予定日）の案件を地図用に取得する。キャンセルは除く。1日分・1社分なので数十〜百件程度。
 * driverId を指定するとそのドライバーの案件だけ、"unassigned" なら未割当だけ。
 */
export async function getMapOrders(tx: Tx, day: DateString, driver?: string): Promise<MapOrder[]> {
  const driverFilter = driver === "unassigned" ? "unassigned" : driver && z.uuid().safeParse(driver).success ? driver : null;
  const rows = await tx<{
    id: string; order_no: string; status: OrderStatus; is_late: boolean; client_name: string; driver_id: string | null; driver_name: string | null;
    delivery_name: string; delivery_address: string; delivery_lat: number | null; delivery_lng: number | null;
    pickup_at: Date; delivery_at: Date; completed_at: Date | null;
  }[]>`
    select o.id, o.order_no, o.status, f.is_late, c.name client_name, o.driver_id, d.name driver_name,
           o.delivery_name, o.delivery_address, o.delivery_lat, o.delivery_lng, o.pickup_at, o.delivery_at, o.completed_at
      from delivery_orders o
      join v_order_facts f on f.id = o.id
      join clients c on c.id = o.client_id
      left join drivers d on d.id = o.driver_id
     where o.delivery_at >= app.jst_start(${day}::date) and o.delivery_at < app.jst_start(${day}::date + 1)
       and o.status <> 'cancelled'
       ${driverFilter === "unassigned" ? tx`and o.driver_id is null` : driverFilter ? tx`and o.driver_id = ${driverFilter}` : tx``}
     order by o.delivery_at, o.order_no`;
  return rows.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    state: mapState(r.status, r.is_late) ?? "planned",
    status: r.status,
    completedLate: r.status === "delivered" && r.is_late,
    clientName: r.client_name,
    driverId: r.driver_id,
    driverName: r.driver_name,
    deliveryName: r.delivery_name,
    deliveryAddress: r.delivery_address,
    lat: r.delivery_lat,
    lng: r.delivery_lng,
    pickupAt: r.pickup_at.toISOString(),
    deliveryAt: r.delivery_at.toISOString(),
    completedAt: r.completed_at?.toISOString() ?? null,
  }));
}
