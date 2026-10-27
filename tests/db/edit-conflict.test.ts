/**
 * DB テスト：同時編集の検知に使う「更新の印」（version）。
 * 案件の編集画面を開いた後に、ドライバーのステータス更新や他の管理者の保存があれば印が変わり、
 * 保存（saveOrder）は古い印のままでは上書きしない。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { runAsUser } from "@/lib/db/rls";
import { getOrderDetail } from "@/lib/data/orders";
import { connectTyped, createTenant, dropTenant, type TestTenant } from "./helpers";

let sql: Sql;
let a: TestTenant;

beforeAll(async () => {
  sql = connectTyped();
  a = await createTenant(sql, { seed: 1414, now: new Date() });
});

afterAll(async () => {
  await dropTenant(sql, a);
  await sql.end();
});

describe("更新の印", () => {
  it("ドライバーの操作・管理者の保存のたびに変わり、変更が無ければ変わらない", async () => {
    const [order] = await sql<{ id: string }[]>`
      select id from delivery_orders where company_id = ${a.companyId} and driver_id = ${a.driverId} and status = 'assigned'
       order by delivery_at limit 1`;
    const version = async () => (await runAsUser(sql, a.adminId, (tx) => getOrderDetail(tx, order.id)))!.version;

    const v1 = await version();
    expect(v1).toMatch(/^\d+$/);
    expect(await version()).toBe(v1);

    // ドライバーが集荷完了にした
    await runAsUser(sql, a.driverUserId, (tx) => tx`select driver_update_status(${order.id}, 'assigned', 'picked_up', null)`);
    const v2 = await version();
    expect(v2).not.toBe(v1);

    // 別の管理者が備考を保存した（同じミリ秒の中でも区別できるよう、マイクロ秒まで含める）
    await runAsUser(sql, a.adminId, (tx) => tx`update delivery_orders set notes = '受付で受領印' where id = ${order.id}`);
    const v3 = await version();
    expect(v3).not.toBe(v2);
    expect(v3.length).toBeGreaterThanOrEqual(16);
  });
});
