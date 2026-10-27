import { describe, expect, it } from "vitest";
import { adminActions, canTransition, ORDER_STATUSES } from "@/lib/domain/status";
import { emptyOrderForm, orderFormSchema, parseLocalDateTime, toLocalDateTime } from "@/lib/validation/order";

const valid = {
  ...emptyOrderForm("2026-10-28"),
  clientId: "6f1c2f9e-3b1a-4c2d-9e8f-0a1b2c3d4e5f",
  pickupAddress: "東京都大田区東海3-6-1",
  deliveryName: "テスト配送先",
  deliveryAddress: "東京都港区芝浦3-4-1",
  cargoType: "書類",
  fee: 5500,
};

describe("案件フォームの入力チェック（画面とサーバーで共通）", () => {
  it("正しい入力は通り、未選択のドライバー・車両は null になる", () => {
    const r = orderFormSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.driverId).toBeNull();
      expect(r.data.vehicleId).toBeNull();
    }
  });

  it("必須項目が空なら項目ごとにエラーを返す", () => {
    const r = orderFormSchema.safeParse({ ...valid, deliveryName: "  ", clientId: "" });
    expect(r.success).toBe(false);
    const paths = r.error?.issues.map((i) => i.path[0]);
    expect(paths).toContain("deliveryName");
    expect(paths).toContain("clientId");
  });

  it("配送予定が集荷予定より前ならエラー", () => {
    const r = orderFormSchema.safeParse({ ...valid, pickupAt: "2026-10-28T12:00", deliveryAt: "2026-10-28T11:00" });
    expect(r.error?.issues[0].path).toEqual(["deliveryAt"]);
  });

  it("車両だけ指定してドライバー未指定はエラー", () => {
    const r = orderFormSchema.safeParse({ ...valid, vehicleId: "6f1c2f9e-3b1a-4c2d-9e8f-0a1b2c3d4e60" });
    expect(r.error?.issues[0].path).toEqual(["vehicleId"]);
  });

  it("料金は0円以上の整数・数量は1以上", () => {
    expect(orderFormSchema.safeParse({ ...valid, fee: -1 }).success).toBe(false);
    expect(orderFormSchema.safeParse({ ...valid, fee: 100.5 }).success).toBe(false);
    expect(orderFormSchema.safeParse({ ...valid, quantity: 0 }).success).toBe(false);
    expect(orderFormSchema.safeParse({ ...valid, fee: Number.NaN }).success).toBe(false);
  });

  it("日時は日本時間として解釈し、元に戻せる", () => {
    const d = parseLocalDateTime("2026-10-28T09:30");
    expect(d.toISOString()).toBe("2026-10-28T00:30:00.000Z");
    expect(toLocalDateTime(d)).toBe("2026-10-28T09:30");
  });
});

describe("管理者のステータス操作", () => {
  it("案件詳細のボタンはすべて許可された遷移だけ", () => {
    for (const s of ORDER_STATUSES) {
      for (const a of adminActions(s)) {
        if (a.kind === "status") expect(canTransition(s, a.to), `${s} → ${a.to}`).toBe(true);
        else expect(s).toBe("assigned");
      }
    }
  });

  it("配送失敗・キャンセルは理由が必須", () => {
    for (const s of ORDER_STATUSES) {
      for (const a of adminActions(s)) {
        if (a.kind === "status" && (a.to === "failed" || a.to === "cancelled")) expect(a.requiresNote).toBe(true);
      }
    }
  });
});
