/**
 * ドライバーの現在地（地図表示）。
 *   GPS：ドライバーがスマホで位置情報を共有しているとき、最後に受け取った位置
 *   模擬位置：デモ・見本の会社（データが架空）で、共有していないドライバーの位置を本日の予定から求めたもの
 * どちらも「今どの仕事をしているか」は案件のステータスから同じ規則で決める。
 */
import type { OrderStatus } from "./status";

export type LatLng = { lat: number; lng: number };

/** GPS の位置を地図に出す期限（これより古い位置は出さない） */
export const GPS_VISIBLE_MINUTES = 120;
/** これより更新が止まっている GPS の位置は「更新なし」として薄く表示する */
export const GPS_STALE_MINUTES = 10;
/** 模擬位置：集荷の何分前に出発するか */
const DEPART_BEFORE_PICKUP_MINUTES = 45;
/** 模擬位置：最後の配送のあと、何分まで待機中として表示するか */
const SHOW_AFTER_LAST_MINUTES = 30;

export type DriverActivity = "to_delivery" | "to_pickup" | "waiting";

export const DRIVER_ACTIVITY_LABEL: Record<DriverActivity, string> = {
  to_delivery: "配送中",
  to_pickup: "次の集荷へ",
  waiting: "待機中",
};

/** 位置の計算に使う、ドライバーの本日の案件 */
export type PositionOrder = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  deliveryName: string;
  pickupAt: Date;
  deliveryAt: Date;
  completedAt: Date | null;
  pickup: LatLng | null;
  delivery: LatLng | null;
};

export type DriverPosition = {
  driverId: string;
  driverName: string;
  lat: number;
  lng: number;
  source: "gps" | "simulated";
  /** ISO。GPS は最後に受け取った時刻、模擬位置は計算した時刻 */
  updatedAt: string;
  /** GPS の更新が止まっている */
  stale: boolean;
  /** GPS の精度（メートル） */
  accuracyM: number | null;
  activity: DriverActivity;
  order: { id: string; orderNo: string; deliveryName: string; status: OrderStatus } | null;
};

/** 管理者の地図に渡す現在地の一覧 */
export type DriverPositions = {
  /** 取得した時刻（ISO）。画面の定期更新で、新しいほうを使うため */
  at: string;
  positions: DriverPosition[];
};

const MINUTE = 60_000;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: Number((a.lat + (b.lat - a.lat) * t).toFixed(6)), lng: Number((a.lng + (b.lng - a.lng) * t).toFixed(6)) };
}

const isFinished = (o: PositionOrder) => o.status === "delivered" || o.status === "failed";
const finishedAt = (o: PositionOrder) => o.completedAt ?? o.deliveryAt;

/**
 * いま取り組んでいる仕事：集荷済み・配送中の案件 → 配送中、配車済の案件 → 次の集荷へ、すべて終わった → 待機中。
 * 本日の案件がなければ null（勤務外）。
 */
export function currentWork(orders: PositionOrder[]): { activity: DriverActivity; order: PositionOrder | null } | null {
  const moving = orders
    .filter((o) => o.status === "picked_up" || o.status === "in_transit")
    .sort((a, b) => a.deliveryAt.getTime() - b.deliveryAt.getTime())[0];
  if (moving) return { activity: "to_delivery", order: moving };
  const next = orders
    .filter((o) => o.status === "assigned")
    .sort((a, b) => a.pickupAt.getTime() - b.pickupAt.getTime())[0];
  if (next) return { activity: "to_pickup", order: next };
  if (orders.some(isFinished)) return { activity: "waiting", order: null };
  return null;
}

/**
 * 模擬位置（デモ用）。本日の予定とステータスから、ドライバーがいそうな位置を直線で補間して求める。
 *   配送中：集荷先 → 配送先を予定時刻の割合で進む
 *   次の集荷へ：直前の配送先（無ければ営業所）から、集荷の45分前に出発して集荷先へ向かう
 *   待機中：最後の配送先に30分まで
 * 勤務前・勤務後・位置の分からない案件のときは null（地図に出さない）。
 */
export function simulatePosition(
  orders: PositionOrder[],
  now: Date,
  office: LatLng | null,
): { position: LatLng; activity: DriverActivity; order: PositionOrder | null } | null {
  const work = currentWork(orders);
  if (!work) return null;
  const t = now.getTime();
  const lastDone = orders
    .filter((o) => isFinished(o) && finishedAt(o).getTime() <= t)
    .sort((a, b) => finishedAt(b).getTime() - finishedAt(a).getTime())[0];

  if (work.activity === "to_delivery" && work.order) {
    const o = work.order;
    if (!o.delivery) return null;
    if (!o.pickup) return { position: o.delivery, activity: work.activity, order: o };
    const span = Math.max(o.deliveryAt.getTime() - o.pickupAt.getTime(), MINUTE);
    const progress = clamp((t - o.pickupAt.getTime()) / span, 0.05, 0.95);
    return { position: lerp(o.pickup, o.delivery, progress), activity: work.activity, order: o };
  }

  if (work.activity === "to_pickup" && work.order) {
    const o = work.order;
    const start = lastDone?.delivery ?? office;
    if (!o.pickup || !start) return null;
    const lastEnd = lastDone ? finishedAt(lastDone).getTime() : -Infinity;
    const leaveAt = Math.max(lastEnd, o.pickupAt.getTime() - DEPART_BEFORE_PICKUP_MINUTES * MINUTE);
    if (t < leaveAt) {
      // 出発前：前の配送先で待機。その日の最初の案件の前は勤務前として出さない
      return lastDone ? { position: start, activity: "waiting", order: o } : null;
    }
    const span = Math.max(o.pickupAt.getTime() - leaveAt, MINUTE);
    return { position: lerp(start, o.pickup, clamp((t - leaveAt) / span, 0, 1)), activity: work.activity, order: o };
  }

  if (lastDone?.delivery && t - finishedAt(lastDone).getTime() <= SHOW_AFTER_LAST_MINUTES * MINUTE) {
    return { position: lastDone.delivery, activity: "waiting", order: null };
  }
  return null;
}

/** 「3分前」などの表示 */
export function minutesAgo(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / MINUTE));
}
