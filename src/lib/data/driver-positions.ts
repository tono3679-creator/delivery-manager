import "server-only";
import type { Tx } from "@/lib/db";
import { toJstDate } from "@/lib/date";
import {
  currentWork, GPS_STALE_MINUTES, GPS_VISIBLE_MINUTES, simulatePosition,
  type DriverPosition, type DriverPositions, type PositionOrder,
} from "@/lib/domain/driver-position";
import type { OrderStatus } from "@/lib/domain/status";

const point = (lat: number | null, lng: number | null) => (lat !== null && lng !== null ? { lat, lng } : null);

/**
 * 自社の在籍ドライバー（退職者を除く）の現在地（管理者用。RLS により自社だけ）。
 * 位置を共有中（2時間以内に受信）なら GPS、それ以外は模擬位置の会社（デモ・見本）だけ本日の予定から求める。
 */
export async function getDriverPositions(tx: Tx, now: Date = new Date()): Promise<DriverPositions> {
  const day = toJstDate(now);
  const [[company], drivers, orders] = await Promise.all([
    tx<{ simulate_locations: boolean }[]>`select simulate_locations from companies where id = app.current_company_id()`,
    tx<{
      id: string; name: string; office_lat: number | null; office_lng: number | null;
      lat: number | null; lng: number | null; accuracy_m: number | null; updated_at: Date | null;
    }[]>`
      select d.id, d.name, f.lat office_lat, f.lng office_lng, l.lat, l.lng, l.accuracy_m, l.updated_at
        from drivers d
        left join offices f on f.id = d.office_id
        left join driver_locations l
          on l.driver_id = d.id and l.updated_at > ${now}::timestamptz - make_interval(mins => ${GPS_VISIBLE_MINUTES})
       where d.status <> 'retired'
       order by d.code`,
    tx<{
      id: string; order_no: string; status: OrderStatus; driver_id: string; delivery_name: string;
      pickup_at: Date; delivery_at: Date; completed_at: Date | null;
      pickup_lat: number | null; pickup_lng: number | null; delivery_lat: number | null; delivery_lng: number | null;
    }[]>`
      select o.id, o.order_no, o.status, o.driver_id, o.delivery_name, o.pickup_at, o.delivery_at, o.completed_at,
             o.pickup_lat, o.pickup_lng, o.delivery_lat, o.delivery_lng
        from delivery_orders o
       where o.driver_id is not null and o.status <> 'cancelled'
         and o.delivery_at >= app.jst_start(${day}::date) and o.delivery_at < app.jst_start(${day}::date + 1)`,
  ]);

  const byDriver = new Map<string, PositionOrder[]>();
  for (const o of orders) {
    const list = byDriver.get(o.driver_id) ?? [];
    list.push({
      id: o.id,
      orderNo: o.order_no,
      status: o.status,
      deliveryName: o.delivery_name,
      pickupAt: o.pickup_at,
      deliveryAt: o.delivery_at,
      completedAt: o.completed_at,
      pickup: point(o.pickup_lat, o.pickup_lng),
      delivery: point(o.delivery_lat, o.delivery_lng),
    });
    byDriver.set(o.driver_id, list);
  }

  const summary = (o: PositionOrder | null) =>
    o ? { id: o.id, orderNo: o.orderNo, deliveryName: o.deliveryName, status: o.status } : null;

  const positions: DriverPosition[] = [];
  for (const d of drivers) {
    const mine = byDriver.get(d.id) ?? [];
    if (d.lat !== null && d.lng !== null && d.updated_at) {
      const work = currentWork(mine);
      positions.push({
        driverId: d.id,
        driverName: d.name,
        lat: d.lat,
        lng: d.lng,
        source: "gps",
        updatedAt: d.updated_at.toISOString(),
        stale: now.getTime() - d.updated_at.getTime() > GPS_STALE_MINUTES * 60_000,
        accuracyM: d.accuracy_m === null ? null : Math.round(d.accuracy_m),
        activity: work?.activity ?? "waiting",
        order: summary(work?.order ?? null),
      });
      continue;
    }
    if (!company?.simulate_locations) continue;
    const sim = simulatePosition(mine, now, point(d.office_lat, d.office_lng));
    if (!sim) continue;
    positions.push({
      driverId: d.id,
      driverName: d.name,
      lat: sim.position.lat,
      lng: sim.position.lng,
      source: "simulated",
      updatedAt: now.toISOString(),
      stale: false,
      accuracyM: null,
      activity: sim.activity,
      order: summary(sim.order),
    });
  }
  return { at: now.toISOString(), positions };
}

/** ドライバー本人：位置を共有中か（最後に受け付けた時刻。共有していなければ null） */
export async function getOwnLocationSharing(tx: Tx, driverId: string): Promise<string | null> {
  const [row] = await tx<{ updated_at: Date }[]>`select updated_at from driver_locations where driver_id = ${driverId}`;
  return row ? row.updated_at.toISOString() : null;
}
