import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, canTransition, driverActions, isLate } from "@/lib/domain/status";

describe("ステータス遷移", () => {
  it("基本フローを順に進められる", () => {
    expect(canTransition("unassigned", "assigned")).toBe(true);
    expect(canTransition("assigned", "picked_up")).toBe(true);
    expect(canTransition("picked_up", "in_transit")).toBe(true);
    expect(canTransition("in_transit", "delivered")).toBe(true);
  });

  it("飛ばしたり戻したりはできない", () => {
    expect(canTransition("assigned", "delivered")).toBe(false);
    expect(canTransition("delivered", "assigned")).toBe(false);
    expect(canTransition("cancelled", "assigned")).toBe(false);
    expect(canTransition("in_transit", "cancelled")).toBe(false);
  });

  it("完了・キャンセル後は何にも変えられない", () => {
    for (const to of ORDER_STATUSES) {
      expect(canTransition("delivered", to)).toBe(false);
      expect(canTransition("cancelled", to)).toBe(false);
    }
  });

  it("ドライバーの操作は進む方向だけ", () => {
    expect(driverActions("assigned").map((a) => a.to)).toEqual(["picked_up"]);
    expect(driverActions("in_transit").map((a) => a.to)).toEqual(["delivered", "failed"]);
    expect(driverActions("delivered")).toEqual([]);
    expect(driverActions("in_transit").find((a) => a.to === "failed")?.requiresNote).toBe(true);
  });
});

describe("遅延判定", () => {
  const deliveryAt = new Date("2026-10-27T03:00:00Z");
  it("予定から15分以内の完了は遅延ではない", () => {
    expect(isLate({ status: "delivered", deliveryAt, completedAt: new Date("2026-10-27T03:15:00Z") }, new Date())).toBe(false);
    expect(isLate({ status: "delivered", deliveryAt, completedAt: new Date("2026-10-27T03:16:00Z") }, new Date())).toBe(true);
  });
  it("未完了で予定を過ぎたら遅延", () => {
    expect(isLate({ status: "in_transit", deliveryAt, completedAt: null }, new Date("2026-10-27T03:20:00Z"))).toBe(true);
    expect(isLate({ status: "in_transit", deliveryAt, completedAt: null }, new Date("2026-10-27T03:10:00Z"))).toBe(false);
    expect(isLate({ status: "cancelled", deliveryAt, completedAt: null }, new Date("2026-10-28T00:00:00Z"))).toBe(false);
  });
});
