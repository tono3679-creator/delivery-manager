/**
 * DB テスト：Phase 3（ドライバー・車両・荷主の管理、売上・利益分析）。
 *   1. 画面ごとに取得する売上・件数が、同じ期間なら一致すること（ドライバー一覧／詳細／分析、荷主一覧／詳細／分析、ダッシュボード）
 *   2. マスタの保存禁止ルールが DB で守られること（画面やサーバー処理を通さない更新でも崩れない）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { runAsUser } from "@/lib/db/rls";
import { getAnalytics, getExpenseBreakdown, listExpenses, parseExpenseFilters, resolvePeriod } from "@/lib/data/analytics";
import { getClientDetail, listClients, parseClientFilters } from "@/lib/data/clients";
import { getDashboardKpis } from "@/lib/data/dashboard";
import { getDriverDetail, listDrivers, parseDriverFilters } from "@/lib/data/drivers";
import { getVehicleDetail, listVehicles, parseVehicleFilters } from "@/lib/data/vehicles";
import { addMonths, startOfMonth, todayJst } from "@/lib/date";
import { connectTyped, createTenant, dropTenant, type TestTenant } from "./helpers";

let sql: Sql;
let a: TestTenant;
let b: TestTenant;
const today = todayJst();

beforeAll(async () => {
  sql = connectTyped();
  const now = new Date();
  a = await createTenant(sql, { seed: 505, now });
  b = await createTenant(sql, { seed: 606, now });
});

afterAll(async () => {
  await dropTenant(sql, a);
  await dropTenant(sql, b);
  await sql.end();
});

const asAdminA = <T>(fn: Parameters<typeof runAsUser<T>>[2]) => runAsUser(sql, a.adminId, fn);
const asAdminB = <T>(fn: Parameters<typeof runAsUser<T>>[2]) => runAsUser(sql, b.adminId, fn);

describe("画面間で数字が一致する（今月1日〜本日）", () => {
  it("ドライバー一覧・ドライバー詳細・売上分析のドライバー別が一致する", async () => {
    const { list, analytics, details } = await asAdminA(async (tx) => {
      const list = await listDrivers(tx, parseDriverFilters({}), today);
      const analytics = await getAnalytics(tx, resolvePeriod({}, today));
      const details = await Promise.all(list.slice(0, 5).map((d) => getDriverDetail(tx, d.id, today)));
      return { list, analytics, details };
    });
    expect(list.length).toBeGreaterThan(0);
    for (const d of list) {
      const row = analytics.drivers.find((x) => x.driverId === d.id);
      expect(row, d.name).toBeDefined();
      expect([d.name, d.monthRevenue, d.monthDelivered, d.monthOrders, d.monthLate])
        .toEqual([d.name, row!.revenue, row!.delivered, row!.orders, row!.late]);
    }
    for (const detail of details) {
      const row = list.find((x) => x.id === detail!.id)!;
      expect(detail!.month.revenue).toBe(row.monthRevenue);
      expect(detail!.month.delivered).toBe(row.monthDelivered);
      // 月別グラフの最後の棒（今月）も同じ値
      const last = detail!.series.at(-1)!;
      expect(last.bucket).toBe(startOfMonth(today));
      expect([last.revenue, last.delivered, last.orders, last.late]).toEqual([row.monthRevenue, row.monthDelivered, row.monthOrders, row.monthLate]);
    }
    // ドライバー別の合計 = 期間の売上合計（配送完了の案件には必ず担当がいる）
    expect(analytics.drivers.reduce((s, d) => s + d.revenue, 0)).toBe(analytics.summary.revenue);
  });

  it("荷主一覧・荷主詳細・売上分析の荷主別が一致する（前月分も）", async () => {
    const { list, analytics, lastMonth, details } = await asAdminA(async (tx) => {
      const list = await listClients(tx, parseClientFilters({}), today);
      const analytics = await getAnalytics(tx, resolvePeriod({}, today));
      const lastMonth = await getAnalytics(tx, resolvePeriod({ period: "last_month" }, today));
      const details = await Promise.all(list.map((c) => getClientDetail(tx, c.id, today)));
      return { list, analytics, lastMonth, details };
    });
    expect(list.length).toBe(a.data.clients.length);
    for (const c of list) {
      const now = analytics.clients.find((x) => x.clientId === c.id)!;
      const prev = lastMonth.clients.find((x) => x.clientId === c.id)!;
      expect([c.name, c.monthRevenue, c.monthOrders, c.prevMonthRevenue]).toEqual([c.name, now.revenue, now.orders, prev.revenue]);
      const detail = details.find((d) => d!.id === c.id)!;
      expect(detail.series.at(-1)!.revenue).toBe(c.monthRevenue);
      expect(detail.series.at(-2)!.revenue).toBe(c.prevMonthRevenue);
    }
    expect(list.reduce((s, c) => s + c.monthRevenue, 0)).toBe(analytics.summary.revenue);
  });

  it("売上分析の合計・推移・経費の内訳・経費一覧・ダッシュボードが一致する", async () => {
    const r = await asAdminA(async (tx) => {
      const period = resolvePeriod({ period: "last_3_months" }, today);
      return {
        analytics: await getAnalytics(tx, period),
        breakdown: await getExpenseBreakdown(tx, period.from, period.to),
        expenses: await listExpenses(tx, period, parseExpenseFilters({})),
        month: await getAnalytics(tx, resolvePeriod({}, today)),
        kpis: await getDashboardKpis(tx, today),
      };
    });
    const { summary, series } = r.analytics;
    expect(series.reduce((s, p) => s + p.revenue, 0)).toBe(summary.revenue);
    expect(series.reduce((s, p) => s + p.expense, 0)).toBe(summary.expense);
    expect(series.reduce((s, p) => s + p.grossProfit, 0)).toBe(summary.grossProfit);
    expect(r.breakdown.reduce((s, b) => s + b.amount, 0)).toBe(summary.expense);
    expect(r.expenses.amount).toBe(summary.expense);
    expect(summary.grossProfit).toBe(summary.revenue - summary.expense);
    // ダッシュボードの「今月の売上・粗利益」= 売上分析の「今月」
    expect(r.kpis.monthRevenue).toBe(r.month.summary.revenue);
    expect(r.kpis.monthGrossProfit).toBe(r.month.summary.grossProfit);
  });

  it("前の期間との比較：今月は前月の同じ日まで、先月は前々月と比べる", () => {
    const thisMonth = resolvePeriod({}, "2026-10-27");
    expect([thisMonth.from, thisMonth.to]).toEqual(["2026-10-01", "2026-10-27"]);
    const last = resolvePeriod({ period: "last_month" }, "2026-10-27");
    expect([last.from, last.to]).toEqual(["2026-09-01", "2026-09-30"]);
  });

  it("比較する期間の途中から記録が始まっている場合は、増減を比べない", async () => {
    await asAdminA(async (tx) => {
      // デモデータは約6か月分。直近3か月の比較（その前の3か月）は記録の範囲内
      const three = await getAnalytics(tx, resolvePeriod({ period: "last_3_months" }, today));
      expect(three.previous.complete).toBe(true);
      expect(three.previous.revenue).toBeGreaterThan(0);
      // 直近6か月の比較（その前の6か月）は記録の開始より前を含む
      const six = await getAnalytics(tx, resolvePeriod({ period: "last_6_months" }, today));
      expect(six.previous.complete).toBe(false);
      expect(six.previous.recordStart! > six.previous.from).toBe(true);
      expect(six.previous.recordStart! <= addMonths(today, -5)).toBe(true);
    });
  });

  it("車両詳細の経費合計は、その車両に紐づく経費の合計と一致する", async () => {
    const vehicleId = a.data.vehicles[0].id as string;
    const from6 = startOfMonth(addMonths(today, -5));
    const expected = a.data.expenses
      .filter((e) => e.vehicle_id === vehicleId && String(e.spent_on) >= from6 && String(e.spent_on) <= today)
      .reduce((s, e) => s + Number(e.amount), 0);
    const detail = await asAdminA((tx) => getVehicleDetail(tx, vehicleId, today));
    expect(detail!.expenseTotal6m).toBe(expected);
  });

  it("他社の ID を指定しても詳細は取得できない", async () => {
    const otherDriver = b.data.drivers[0].id as string;
    const otherClient = b.data.clients[0].id as string;
    const otherVehicle = b.data.vehicles[0].id as string;
    const r = await asAdminA(async (tx) => [
      await getDriverDetail(tx, otherDriver, today),
      await getClientDetail(tx, otherClient, today),
      await getVehicleDetail(tx, otherVehicle, today),
    ]);
    expect(r).toEqual([null, null, null]);
  });
});

describe("一覧の検索", () => {
  it("ドライバー：キーワード・ステータスで絞り込める。不正な値は無視する", async () => {
    const target = a.data.drivers[3];
    const r = await asAdminA(async (tx) => ({
      byName: await listDrivers(tx, parseDriverFilters({ q: String(target.name).split(" ")[0] }), today),
      byStatus: await listDrivers(tx, parseDriverFilters({ status: "leave" }), today),
      bad: parseDriverFilters({ status: "x' or 1=1", employment: "boss" }),
      injection: await listDrivers(tx, parseDriverFilters({ q: "%' or 1=1 --" }), today),
    }));
    expect(r.byName.map((d) => d.id)).toContain(target.id);
    expect(r.byStatus.every((d) => d.status === "leave")).toBe(true);
    expect(r.bad).toEqual({});
    expect(r.injection).toEqual([]);
  });

  it("車両：期限が近い車両だけを表示できる", async () => {
    const r = await asAdminA((tx) => listVehicles(tx, parseVehicleFilters({ due: "1" }), today));
    expect(r.every((v) => v.status !== "retired" && Math.min(v.inspectionDays, v.insuranceDays) <= 30)).toBe(true);
  });
});

async function newDriver(tenant: TestTenant, name: string) {
  const [d] = await runAsUser(sql, tenant.adminId, (tx) => tx<{ id: string }[]>`
    insert into drivers (company_id, name) values (${tenant.companyId}, ${name}) returning id`);
  return d.id;
}

async function newVehicle(tenant: TestTenant, plate: string) {
  const [v] = await runAsUser(sql, tenant.adminId, (tx) => tx<{ id: string }[]>`
    insert into vehicles (company_id, plate_number, vehicle_type, maker, inspection_expires_on, insurance_expires_on)
    values (${tenant.companyId}, ${plate}, '軽バン', 'テスト', current_date + 365, current_date + 365) returning id`);
  return v.id;
}

/** 案件を1件、指定のドライバー・車両で「配車済」にする（保存禁止ルールの確認用） */
async function assignActiveOrder(tenant: TestTenant, driverId: string, vehicleId: string | null) {
  return runAsUser(sql, tenant.adminId, async (tx) => {
    const [o] = await tx<{ id: string }[]>`
      insert into delivery_orders (company_id, client_id, pickup_address, delivery_name, delivery_address, pickup_at, delivery_at,
                                   driver_id, vehicle_id, cargo_type, quantity, fee)
      values (${tenant.companyId}, ${tenant.data.clients[0].id as string}, '東京都港区芝浦1-1', 'テスト配送先', '東京都港区海岸1-1',
              now() + interval '1 day', now() + interval '1 day 1 hour', ${driverId}, ${vehicleId}, 'テスト', 1, 5000)
      returning id`;
    return o.id;
  });
}

describe("マスタの保存ルール（DB で拒否する）", () => {
  it("管理コードは会社ごとに自動で振られる", async () => {
    const codes = await asAdminA(async (tx) => {
      const [d] = await tx<{ code: string }[]>`insert into drivers (company_id, name) values (${a.companyId}, '新人 ドライバー') returning code`;
      const [c] = await tx<{ code: string }[]>`insert into clients (company_id, name) values (${a.companyId}, 'テスト荷主') returning code`;
      const [v] = await tx<{ code: string }[]>`
        insert into vehicles (company_id, plate_number, vehicle_type, maker, inspection_expires_on, insurance_expires_on)
        values (${a.companyId}, 'テスト 400 あ 00-01', '軽バン', 'テスト', current_date + 365, current_date + 365) returning code`;
      return [d.code, c.code, v.code];
    });
    expect(codes).toEqual([
      `D-${String(a.data.drivers.length + 1).padStart(3, "0")}`,
      `C-${String(a.data.clients.length + 1).padStart(3, "0")}`,
      `V-${String(a.data.vehicles.length + 1).padStart(3, "0")}`,
    ]);
  });

  it("対応中の案件があるドライバーは休職・退職にできない", async () => {
    const driverId = await newDriver(a, "休職 テスト");
    const orderId = await assignActiveOrder(a, driverId, null);
    await expect(asAdminA((tx) => tx`update drivers set status = 'leave' where id = ${driverId}`)).rejects.toThrow(/対応中の案件が1件/);
    await expect(asAdminA((tx) => tx`update drivers set status = 'retired' where id = ${driverId}`)).rejects.toThrow(/対応中の案件が1件/);
    // 本日休みへの変更や、案件を外した後なら変更できる
    await asAdminA((tx) => tx`update drivers set status = 'day_off' where id = ${driverId}`);
    await asAdminA((tx) => tx`update delivery_orders set driver_id = null where id = ${orderId}`);
    await asAdminA((tx) => tx`update drivers set status = 'leave' where id = ${driverId}`);
    const [row] = await sql<{ status: string }[]>`select status from drivers where id = ${driverId}`;
    expect(row.status).toBe("leave");
  });

  it("対応中の案件で使っている車両は整備中・廃車にできない", async () => {
    const [current] = await sql<{ vehicle_id: string; driver_id: string }[]>`
      select va.vehicle_id, va.driver_id from vehicle_assignments va join drivers d on d.id = va.driver_id
       where va.company_id = ${a.companyId} and va.end_on is null and d.status = 'active' and va.driver_id <> ${a.driverId}
       order by d.code desc limit 1`;
    await assignActiveOrder(a, current.driver_id, current.vehicle_id);
    await expect(asAdminA((tx) => tx`update vehicles set status = 'maintenance' where id = ${current.vehicle_id}`))
      .rejects.toThrow(/対応中の案件/);
    await expect(asAdminA((tx) => tx`update vehicles set status = 'retired' where id = ${current.vehicle_id}`))
      .rejects.toThrow(/対応中の案件/);
  });

  it("退職・廃車にすると現在の担当が今日で終わり、新しく担当にはできない", async () => {
    const driverId = await newDriver(a, "退職 テスト");
    const vehicleId = await newVehicle(a, "テスト 400 あ 90-01");
    const vehicle2 = await newVehicle(a, "テスト 400 あ 90-02");
    await asAdminA((tx) => tx`
      insert into vehicle_assignments (company_id, vehicle_id, driver_id, start_on) values (${a.companyId}, ${vehicleId}, ${driverId}, current_date - 10)`);
    await asAdminA((tx) => tx`update drivers set status = 'retired' where id = ${driverId}`);
    const [ended] = await sql<{ end_on: string | null }[]>`select end_on from vehicle_assignments where vehicle_id = ${vehicleId}`;
    expect(ended.end_on).toBe(today);
    await expect(asAdminA((tx) => tx`
      insert into vehicle_assignments (company_id, vehicle_id, driver_id, start_on) values (${a.companyId}, ${vehicle2}, ${driverId}, current_date)`))
      .rejects.toThrow(/退職済み/);

    // 廃車：担当が外れ、廃車の車両は担当にできない
    const driver2 = await newDriver(a, "廃車 テスト");
    await asAdminA((tx) => tx`
      insert into vehicle_assignments (company_id, vehicle_id, driver_id, start_on) values (${a.companyId}, ${vehicle2}, ${driver2}, current_date)`);
    await asAdminA((tx) => tx`update vehicles set status = 'retired' where id = ${vehicle2}`);
    const [ended2] = await sql<{ end_on: string | null }[]>`select end_on from vehicle_assignments where vehicle_id = ${vehicle2}`;
    expect(ended2.end_on).toBe(today);
    await expect(asAdminA((tx) => tx`
      insert into vehicle_assignments (company_id, vehicle_id, driver_id, start_on) values (${a.companyId}, ${vehicle2}, ${driver2}, current_date)`))
      .rejects.toThrow(/廃車/);
  });

  it("他社のドライバー・車両は経費や担当に紐づけられない", async () => {
    const otherDriver = b.data.drivers[0].id as string;
    const otherVehicle = b.data.vehicles[0].id as string;
    await expect(asAdminA((tx) => tx`
      insert into expenses (company_id, spent_on, category, amount, driver_id) values (${a.companyId}, current_date, 'fuel', 1000, ${otherDriver})`))
      .rejects.toThrow(/ドライバーが見つかりません/);
    await expect(asAdminA((tx) => tx`
      insert into expenses (company_id, spent_on, category, amount, vehicle_id) values (${a.companyId}, current_date, 'fuel', 1000, ${otherVehicle})`))
      .rejects.toThrow(/車両が見つかりません/);
    const myDriver = a.data.drivers[0].id as string;
    await expect(asAdminA((tx) => tx`
      insert into vehicle_assignments (company_id, vehicle_id, driver_id, start_on) values (${a.companyId}, ${otherVehicle}, ${myDriver}, current_date)`))
      .rejects.toThrow();
  });

  it("他社のマスタは更新・削除できない（RLS）", async () => {
    const target = b.data.drivers[1].id as string;
    const updated = await asAdminA((tx) => tx`update drivers set name = '書き換え' where id = ${target} returning id`);
    const deleted = await asAdminA((tx) => tx`delete from clients where id = ${b.data.clients[0].id as string} returning id`);
    expect(updated.length).toBe(0);
    expect(deleted.length).toBe(0);
    const [row] = await asAdminB((tx) => tx<{ name: string }[]>`select name from drivers where id = ${target}`);
    expect(row.name).not.toBe("書き換え");
  });

  it("ドライバーは他のドライバーや車両の情報を変更できない", async () => {
    const other = a.data.drivers.find((d) => d.id !== a.driverId)!.id as string;
    const updated = await runAsUser(sql, a.driverUserId, (tx) => tx`update drivers set status = 'retired' where id = ${other} returning id`);
    const expense = runAsUser(sql, a.driverUserId, (tx) => tx`
      insert into expenses (company_id, spent_on, category, amount) values (${a.companyId}, current_date, 'fuel', 1)`);
    expect(updated.length).toBe(0);
    await expect(expense).rejects.toThrow();
  });
});
