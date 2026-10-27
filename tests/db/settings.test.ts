/**
 * DB テスト：設定画面（Phase 5）。営業所の一覧と操作履歴の読み込み。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { runAsUser } from "@/lib/db/rls";
import { getCompanySettings, listAuditLogs, listOffices } from "@/lib/data/settings";
import { auditHref, describeAudit } from "@/lib/domain/audit";
import { connectTyped, createTenant, dropTenant, type TestTenant } from "./helpers";

let sql: Sql;
let a: TestTenant;
let b: TestTenant;

beforeAll(async () => {
  sql = connectTyped();
  const now = new Date();
  a = await createTenant(sql, { seed: 1616, now, isDemo: true });
  b = await createTenant(sql, { seed: 1717, now });
});

afterAll(async () => {
  await dropTenant(sql, a);
  await dropTenant(sql, b);
  await sql.end();
});

const asAdminA = <T>(fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, a.adminId, fn);
const asDriverA = <T>(fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, a.driverUserId, fn);

describe("会社情報・営業所", () => {
  it("自社の会社情報とデモの残り時間が返る", async () => {
    const company = await asAdminA((tx) => getCompanySettings(tx));
    expect(company).toMatchObject({ name: a.data.company.name, isDemo: true });
    expect(company?.demoHoursLeft).toBe(1); // テスト用のデモは1時間後に期限切れ
  });

  it("営業所ごとの所属ドライバー数は drivers の office_id と一致する", async () => {
    const offices = await asAdminA((tx) => listOffices(tx));
    expect(offices.length).toBe(a.data.offices.length);
    for (const o of offices) {
      const expected = a.data.drivers.filter((d) => d.office_id === o.id);
      expect(o.allDrivers).toBe(expected.length);
      expect(o.drivers).toBe(expected.filter((d) => d.status !== "retired").length);
    }
  });
});

describe("操作履歴", () => {
  it("新しい順に 20 件ずつ返し、絞り込みと件数がそろう", async () => {
    const all = await asAdminA((tx) => listAuditLogs(tx, { log: "", page: 1 }));
    expect(all.total).toBe(a.data.auditLogs.length);
    expect(all.rows.length).toBe(Math.min(20, all.total));
    const times = all.rows.map((r) => r.at.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);

    const orders = await asAdminA((tx) => listAuditLogs(tx, { log: "orders", page: 2 }));
    expect(orders.total).toBe(a.data.auditLogs.filter((l) => l.entity === "delivery_order").length);
    expect(orders.rows.every((r) => r.entity === "delivery_order")).toBe(true);
    // 範囲外のページは最後のページにする
    const last = await asAdminA((tx) => listAuditLogs(tx, { log: "", page: 9999 }));
    expect(last.page).toBe(last.pageCount);
  });

  it("配車の記録はドライバー名を引いて「案件番号 → ドライバー」と表示し、案件へリンクする", async () => {
    const { rows } = await asAdminA((tx) => listAuditLogs(tx, { log: "orders", page: 1 }));
    const dispatch = rows.find((r) => r.action === "dispatch");
    expect(dispatch).toBeDefined();
    const toDriverId = dispatch!.detail?.toDriverId as string;
    const driver = a.data.drivers.find((d) => d.id === toDriverId);
    expect(dispatch!.toDriverName).toBe(driver?.name);
    expect(describeAudit(dispatch!)).toBe(`${dispatch!.detail?.orderNo as string} → ${driver?.name as string}`);
    expect(auditHref(dispatch!)).toBe(`/orders/${dispatch!.entityId}`);
  });

  it("削除した対象にはリンクしない", async () => {
    const [order] = await sql<{ id: string; order_no: string }[]>`
      select id, order_no from delivery_orders where company_id = ${a.companyId} and status = 'unassigned' order by delivery_at desc limit 1`;
    await asAdminA(async (tx) => {
      await tx`delete from delivery_orders where id = ${order.id}`;
      await tx`insert into audit_logs (company_id, action, entity, entity_id, detail)
               values (${a.companyId}, 'delete', 'delivery_order', ${order.id}, ${tx.json({ orderNo: order.order_no })})`;
    });
    const { rows } = await asAdminA((tx) => listAuditLogs(tx, { log: "orders", page: 1 }));
    const deleted = rows.filter((r) => r.entityId === order.id);
    expect(deleted.length).toBeGreaterThanOrEqual(1);
    expect(deleted.every((r) => auditHref(r) === null)).toBe(true);
    expect(deleted[0]).toMatchObject({ action: "delete", actorName: "テスト管理者" });
  });

  it("ドライバーと他社の管理者には見えない", async () => {
    const byDriver = await asDriverA((tx) => listAuditLogs(tx, { log: "", page: 1 }));
    expect(byDriver.total).toBe(0);
    const byOther = await runAsUser(sql, b.adminId, (tx) => listAuditLogs(tx, { log: "", page: 1 }));
    expect(byOther.total).toBe(b.data.auditLogs.length);
    expect(byOther.rows.every((r) => !a.data.auditLogs.some((l) => l.id === r.id))).toBe(true);
  });
});
