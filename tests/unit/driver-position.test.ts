import { describe, expect, it } from "vitest";
import { currentWork, minutesAgo, simulatePosition, type PositionOrder } from "@/lib/domain/driver-position";
import type { OrderStatus } from "@/lib/domain/status";

const at = (hhmm: string) => new Date(`2026-10-28T${hhmm}:00+09:00`);
const OFFICE = { lat: 35.6, lng: 139.7 };

function order(no: string, status: OrderStatus, pickup: string, delivery: string, extra: Partial<PositionOrder> = {}): PositionOrder {
  return {
    id: no,
    orderNo: no,
    status,
    deliveryName: `配送先${no}`,
    pickupAt: at(pickup),
    deliveryAt: at(delivery),
    completedAt: null,
    pickup: { lat: 35.0, lng: 139.0 },
    delivery: { lat: 36.0, lng: 140.0 },
    ...extra,
  };
}

describe("いま取り組んでいる仕事", () => {
  it("集荷済み・配送中の案件があれば配送中、なければ次の配車済、すべて終わっていれば待機中", () => {
    expect(currentWork([order("A", "delivered", "09:00", "10:00"), order("B", "in_transit", "10:30", "11:30")])).toMatchObject({
      activity: "to_delivery",
      order: { orderNo: "B" },
    });
    expect(currentWork([order("A", "delivered", "09:00", "10:00"), order("C", "assigned", "13:00", "14:00"), order("B", "assigned", "11:00", "12:00")])).toMatchObject({
      activity: "to_pickup",
      order: { orderNo: "B" },
    });
    expect(currentWork([order("A", "delivered", "09:00", "10:00"), order("B", "failed", "10:30", "11:30")])).toEqual({ activity: "waiting", order: null });
    expect(currentWork([])).toBeNull();
  });
});

describe("模擬位置（デモ）", () => {
  it("配送中は、集荷先から配送先へ予定時刻の割合で進む", () => {
    const r = simulatePosition([order("A", "in_transit", "10:00", "11:00")], at("10:30"), OFFICE);
    expect(r?.activity).toBe("to_delivery");
    expect(r?.position).toEqual({ lat: 35.5, lng: 139.5 });
  });

  it("配送予定を過ぎても配送先の手前で止まり、集荷直後も集荷先から少し進んだ位置になる", () => {
    const late = simulatePosition([order("A", "in_transit", "10:00", "11:00")], at("12:00"), OFFICE);
    expect(late?.position.lat).toBeCloseTo(35.95, 5);
    const early = simulatePosition([order("A", "picked_up", "10:00", "11:00")], at("09:50"), OFFICE);
    expect(early?.position.lat).toBeCloseTo(35.05, 5);
  });

  it("次の集荷へは、前の配送先から集荷の45分前に出発する（それまでは前の配送先で待機）", () => {
    const orders = [
      order("A", "delivered", "08:00", "09:00", { completedAt: at("09:00"), delivery: { lat: 35.2, lng: 139.2 } }),
      order("B", "assigned", "11:00", "12:00", { pickup: { lat: 35.8, lng: 139.8 } }),
    ];
    const waiting = simulatePosition(orders, at("10:00"), OFFICE);
    expect(waiting).toMatchObject({ activity: "waiting", position: { lat: 35.2, lng: 139.2 }, order: { orderNo: "B" } });
    const halfway = simulatePosition(orders, at("10:37"), OFFICE);
    expect(halfway?.activity).toBe("to_pickup");
    expect(halfway?.position.lat).toBeGreaterThan(35.2);
    expect(halfway?.position.lat).toBeLessThan(35.8);
    expect(simulatePosition(orders, at("11:10"), OFFICE)?.position).toEqual({ lat: 35.8, lng: 139.8 });
  });

  it("その日の最初の集荷は営業所から向かい、出発前は地図に出さない", () => {
    const orders = [order("A", "assigned", "09:00", "10:00", { pickup: { lat: 35.9, lng: 139.9 } })];
    expect(simulatePosition(orders, at("08:00"), OFFICE)).toBeNull();
    const r = simulatePosition(orders, at("08:15"), OFFICE);
    expect(r?.activity).toBe("to_pickup");
    expect(r?.position).toEqual(OFFICE);
    expect(simulatePosition(orders, at("09:00"), OFFICE)?.position).toEqual({ lat: 35.9, lng: 139.9 });
  });

  it("すべて終わったら最後の配送先で30分だけ待機中として出し、その後は出さない", () => {
    const orders = [order("A", "delivered", "09:00", "10:00", { completedAt: at("10:05") })];
    expect(simulatePosition(orders, at("10:20"), OFFICE)).toMatchObject({ activity: "waiting", position: { lat: 36, lng: 140 } });
    expect(simulatePosition(orders, at("10:40"), OFFICE)).toBeNull();
  });

  it("位置の分からない案件・本日の案件がないときは出さない", () => {
    expect(simulatePosition([order("A", "in_transit", "10:00", "11:00", { delivery: null })], at("10:30"), OFFICE)).toBeNull();
    expect(simulatePosition([order("A", "assigned", "10:00", "11:00", { pickup: null })], at("09:30"), OFFICE)).toBeNull();
    expect(simulatePosition([], at("10:00"), OFFICE)).toBeNull();
  });
});

it("「何分前」は切り捨てで、未来の時刻は 0 分", () => {
  expect(minutesAgo("2026-10-28T01:00:00Z", new Date("2026-10-28T01:02:59Z"))).toBe(2);
  expect(minutesAgo("2026-10-28T01:05:00Z", new Date("2026-10-28T01:00:00Z"))).toBe(0);
});
