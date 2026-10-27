import { describe, expect, it } from "vitest";
import { previousPeriod, resolvePeriod } from "@/lib/data/analytics";
import { clientSchema, driverSchema, emptyDriverForm, emptyVehicleForm, expenseSchema, vehicleSchema } from "@/lib/validation/master";

describe("マスタの入力チェック", () => {
  const driver = { ...emptyDriverForm("2026-10-27"), name: "佐藤 健太" };

  it("ドライバー：必須・フリガナ・電話・メールを検証する", () => {
    expect(driverSchema.safeParse(driver).success).toBe(true);
    expect(driverSchema.safeParse({ ...driver, name: " " }).success).toBe(false);
    expect(driverSchema.safeParse({ ...driver, nameKana: "さとう" }).success).toBe(false);
    expect(driverSchema.safeParse({ ...driver, nameKana: "サトウ ケンタ" }).success).toBe(true);
    expect(driverSchema.safeParse({ ...driver, phone: "090-1234-5678" }).success).toBe(true);
    expect(driverSchema.safeParse({ ...driver, phone: "<script>" }).success).toBe(false);
    expect(driverSchema.safeParse({ ...driver, email: "not-mail" }).success).toBe(false);
    expect(driverSchema.safeParse({ ...driver, status: "boss" }).success).toBe(false);
    expect(driverSchema.safeParse({ ...driver, hiredOn: "2026-02-30" }).success).toBe(false);
    expect(driverSchema.parse({ ...driver, officeId: "" }).officeId).toBeNull();
  });

  it("車両：積載量は空か 1〜50,000 の整数", () => {
    const v = { ...emptyVehicleForm("2026-10-27"), plateNumber: "品川 400 あ 12-34", vehicleType: "軽バン", maker: "スズキ" };
    expect(emptyVehicleForm("2026-10-27").inspectionExpiresOn).toBe("2028-10-27");
    expect(vehicleSchema.safeParse(v).success).toBe(true);
    expect(vehicleSchema.parse({ ...v, capacityKg: "350" }).capacityKg).toBe(350);
    expect(vehicleSchema.safeParse({ ...v, capacityKg: "0" }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...v, capacityKg: "1.5" }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...v, plateNumber: "" }).success).toBe(false);
  });

  it("荷主：会社名は必須、取引開始日は空か正しい日付", () => {
    const c = { name: "株式会社テスト", contactName: "", phone: "", email: "", address: "", startedOn: "", notes: "" };
    expect(clientSchema.safeParse(c).success).toBe(true);
    expect(clientSchema.safeParse({ ...c, startedOn: "2026/10/01" }).success).toBe(false);
    expect(clientSchema.safeParse({ ...c, name: "a".repeat(101) }).success).toBe(false);
  });

  it("経費：金額は 0 以上の整数、カテゴリは決められた値", () => {
    const e = { spentOn: "2026-10-27", category: "fuel", amount: 3200, driverId: "", vehicleId: "", description: "" } as const;
    expect(expenseSchema.safeParse(e).success).toBe(true);
    expect(expenseSchema.safeParse({ ...e, amount: -1 }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...e, amount: 10.5 }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...e, amount: Number.NaN }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...e, category: "party" }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...e, vehicleId: "x" }).success).toBe(false);
  });
});

describe("売上分析の期間", () => {
  const today = "2026-10-27";

  it("プリセットと集計単位", () => {
    expect(resolvePeriod({}, today)).toMatchObject({ preset: "this_month", from: "2026-10-01", to: today, grain: "day" });
    expect(resolvePeriod({ period: "last_month" }, today)).toMatchObject({ from: "2026-09-01", to: "2026-09-30", grain: "day" });
    expect(resolvePeriod({ period: "last_3_months" }, today)).toMatchObject({ from: "2026-08-01", to: today, grain: "week" });
    expect(resolvePeriod({ period: "last_6_months" }, today)).toMatchObject({ from: "2026-05-01", to: today, grain: "month" });
  });

  it("指定期間：逆順は入れ替え、未来は今日まで、最長2年、不正な値は無視", () => {
    expect(resolvePeriod({ period: "custom", from: "2026-10-20", to: "2026-10-05" }, today)).toMatchObject({ from: "2026-10-05", to: "2026-10-20" });
    expect(resolvePeriod({ period: "custom", from: "2026-10-01", to: "2027-01-01" }, today).to).toBe(today);
    expect(resolvePeriod({ period: "custom", from: "2020-01-01", to: today }, today).from).toBe("2024-10-26");
    expect(resolvePeriod({ period: "hack", from: "x", to: "y" }, today)).toMatchObject({ preset: "this_month", from: "2026-10-01" });
  });

  it("比較する前の期間", () => {
    expect(previousPeriod(resolvePeriod({}, today))).toMatchObject({ from: "2026-09-01", to: "2026-09-27" });
    expect(previousPeriod(resolvePeriod({ period: "last_month" }, today))).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
    expect(previousPeriod(resolvePeriod({ period: "last_3_months" }, today))).toMatchObject({ from: "2026-05-01", to: "2026-07-27" });
    expect(previousPeriod(resolvePeriod({ period: "custom", from: "2026-10-11", to: "2026-10-20" }, today)))
      .toMatchObject({ from: "2026-10-01", to: "2026-10-10" });
    // 月末の日付は前月の末日に丸める
    expect(previousPeriod(resolvePeriod({}, "2026-03-31"))).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });
});
