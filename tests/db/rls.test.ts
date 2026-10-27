/**
 * DB テスト：権限分離（RLS）・ステータス遷移・集計。
 * ローカルの PostgreSQL（scripts/dev/local-supabase-shim.sql ＋ マイグレーション適用済み）で実行する。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { runAsUser } from "@/lib/db/rls";
import { connect, createTenant, dropTenant, type TestTenant } from "./helpers";

let sql: Sql;
let a: TestTenant;
let b: TestTenant;

beforeAll(async () => {
  sql = connect();
  const now = new Date();
  a = await createTenant(sql, { seed: 101, now });
  b = await createTenant(sql, { seed: 202, now, isDemo: true });
});

afterAll(async () => {
  await dropTenant(sql, a);
  await dropTenant(sql, b);
  await sql.end();
});

async function firstOrder(tenant: TestTenant, where: string) {
  const rows = await sql.unsafe<{ id: string; status: string; driver_id: string | null; fee: string }[]>(
    `select id, status, driver_id, fee from delivery_orders where company_id = $1 and ${where} limit 1`,
    [tenant.companyId],
  );
  if (!rows[0]) throw new Error(`該当する案件がありません: ${where}`);
  return rows[0];
}

describe("会社ごとのデータ分離", () => {
  it("管理者は自社の案件だけが見える", async () => {
    const count = await runAsUser(sql, a.adminId, (tx) => tx`select count(*)::int n from delivery_orders`);
    expect(count[0].n).toBe(a.data.orders.length);
    const other = await runAsUser(sql, a.adminId, (tx) =>
      tx`select count(*)::int n from delivery_orders where company_id = ${b.companyId}`);
    expect(other[0].n).toBe(0);
  });

  it("他社の案件は更新・削除できない", async () => {
    const target = await firstOrder(b, "status = 'unassigned'");
    const updated = await runAsUser(sql, a.adminId, (tx) =>
      tx`update delivery_orders set notes = '改ざん' where id = ${target.id} returning id`);
    expect(updated.length).toBe(0);
    const deleted = await runAsUser(sql, a.adminId, (tx) =>
      tx`delete from delivery_orders where id = ${target.id} returning id`);
    expect(deleted.length).toBe(0);
  });

  it("他社の会社IDでは登録できない", async () => {
    const client = b.data.clients[0].id as string;
    await expect(
      runAsUser(sql, a.adminId, (tx) => tx`
        insert into delivery_orders (company_id, client_id, pickup_address, delivery_name, delivery_address,
          pickup_at, delivery_at, cargo_type, quantity, fee)
        values (${b.companyId}, ${client}, 'x', 'x', 'x', now(), now() + interval '1 hour', 'x', 1, 1000)`),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("ドライバーの権限", () => {
  it("自分に割り当てられた案件だけが見える", async () => {
    const rows = await runAsUser(sql, a.driverUserId, (tx) =>
      tx`select count(*)::int n, count(*) filter (where driver_id <> ${a.driverId})::int others from delivery_orders`);
    const expected = a.data.orders.filter((o) => o.driver_id === a.driverId).length;
    expect(rows[0].n).toBe(expected);
    expect(rows[0].others).toBe(0);
  });

  it("経費・他のドライバー・操作履歴は見えない", async () => {
    const rows = await runAsUser(sql, a.driverUserId, async (tx) => {
      const [e] = await tx`select count(*)::int n from expenses`;
      const [d] = await tx`select count(*)::int n from drivers`;
      const [p] = await tx`select count(*)::int n from profiles`;
      return { expenses: e.n, drivers: d.n, profiles: p.n };
    });
    expect(rows).toEqual({ expenses: 0, drivers: 1, profiles: 1 });
  });

  it("売上・利益の集計は呼び出せない", async () => {
    await expect(
      runAsUser(sql, a.driverUserId, (tx) => tx`select * from analytics_summary(current_date - 30, current_date)`),
    ).rejects.toThrow(/管理者のみ/);
  });

  it("案件を直接は更新できない（料金の書き換えなど）", async () => {
    const own = await firstOrder(a, `driver_id = '${a.driverId}'`);
    const updated = await runAsUser(sql, a.driverUserId, (tx) =>
      tx`update delivery_orders set fee = 1 where id = ${own.id} returning id`);
    expect(updated.length).toBe(0);
  });

  it("自分の案件は 集荷完了 → 配送開始 → 配送完了 と進められ、完了日時と履歴が残る", async () => {
    const order = await firstOrder(a, `driver_id = '${a.driverId}' and status = 'assigned'`);
    await runAsUser(sql, a.driverUserId, async (tx) => {
      await tx`select driver_update_status(${order.id}, 'assigned', 'picked_up')`;
      await tx`select driver_update_status(${order.id}, 'picked_up', 'in_transit')`;
      await tx`select driver_update_status(${order.id}, 'in_transit', 'delivered', '受付で受領')`;
    });
    const [row] = await sql`select status, completed_at from delivery_orders where id = ${order.id}`;
    expect(row.status).toBe("delivered");
    expect(row.completed_at).not.toBeNull();
    const logs = await sql`select from_status, to_status, note, changed_by from delivery_status_logs
                           where order_id = ${order.id} order by created_at desc, id desc limit 3`;
    expect(logs.map((l) => l.to_status).sort()).toEqual(["delivered", "in_transit", "picked_up"]);
    expect(logs.find((l) => l.to_status === "delivered")?.note).toBe("受付で受領");
    expect(logs.every((l) => l.changed_by === a.driverUserId)).toBe(true);
    const [notice] = await sql`select count(*)::int n from notifications
                               where company_id = ${a.companyId} and audience = 'admin' and link = ${"/orders/" + order.id}`;
    expect(notice.n).toBe(1);
  });

  it("画面の表示が古い（二重送信）ときは更新しない", async () => {
    const order = await firstOrder(a, `driver_id = '${a.driverId}' and status = 'assigned'`);
    await runAsUser(sql, a.driverUserId, (tx) => tx`select driver_update_status(${order.id}, 'assigned', 'picked_up')`);
    await expect(
      runAsUser(sql, a.driverUserId, (tx) => tx`select driver_update_status(${order.id}, 'assigned', 'picked_up')`),
    ).rejects.toThrow(/更新されています/);
  });

  it("配送失敗には理由が必要", async () => {
    const order = await firstOrder(a, `driver_id = '${a.driverId}' and status = 'assigned'`);
    await runAsUser(sql, a.driverUserId, (tx) => tx`select driver_update_status(${order.id}, 'assigned', 'picked_up')`);
    await expect(
      runAsUser(sql, a.driverUserId, (tx) => tx`select driver_update_status(${order.id}, 'picked_up', 'failed', '')`),
    ).rejects.toThrow(/理由/);
  });

  it("他のドライバーの案件は操作できない", async () => {
    const other = await firstOrder(a, `driver_id <> '${a.driverId}' and status = 'assigned'`);
    await expect(
      runAsUser(sql, a.driverUserId, (tx) => tx`select driver_update_status(${other.id}, 'assigned', 'picked_up')`),
    ).rejects.toThrow(/見つかりません/);
  });

  it("ドライバーは キャンセル などの操作はできない", async () => {
    const order = await firstOrder(a, `driver_id = '${a.driverId}' and status = 'assigned'`);
    await expect(
      runAsUser(sql, a.driverUserId, (tx) => tx`select driver_update_status(${order.id}, 'assigned', 'cancelled')`),
    ).rejects.toThrow(/この操作はできません/);
  });
});

describe("業務ルール", () => {
  it("登録すると案件IDが採番され、履歴が作られる", async () => {
    const client = a.data.clients[0].id as string;
    const [row] = await runAsUser(sql, a.adminId, (tx) => tx`
      insert into delivery_orders (company_id, client_id, pickup_address, delivery_name, delivery_address,
        pickup_at, delivery_at, cargo_type, quantity, fee)
      values (${a.companyId}, ${client}, '東京都大田区', 'テスト納品先', '東京都港区', now() + interval '1 day',
        now() + interval '1 day 1 hour', '書類', 1, 5000)
      returning id, order_no, status`);
    expect(row.order_no).toMatch(/^DM-\d{6}$/);
    expect(row.status).toBe("unassigned");
    const logs = await sql`select to_status, changed_by_name from delivery_status_logs where order_id = ${row.id}`;
    expect(logs).toEqual([{ to_status: "unassigned", changed_by_name: "テスト管理者" }]);
  });

  it("ドライバーを割り当てると「配車済」になり、外すと「未割当」に戻る", async () => {
    const order = await firstOrder(a, "status = 'unassigned'");
    const [assigned] = await runAsUser(sql, a.adminId, (tx) =>
      tx`update delivery_orders set driver_id = ${a.driverId} where id = ${order.id} returning status`);
    expect(assigned.status).toBe("assigned");
    const [unassigned] = await runAsUser(sql, a.adminId, (tx) =>
      tx`update delivery_orders set driver_id = null where id = ${order.id} returning status`);
    expect(unassigned.status).toBe("unassigned");
  });

  it("不正なステータス遷移は拒否する（配送完了 → 配車済）", async () => {
    const order = await firstOrder(a, "status = 'delivered'");
    await expect(
      runAsUser(sql, a.adminId, (tx) => tx`select admin_update_status(${order.id}, 'delivered', 'assigned')`),
    ).rejects.toThrow(/変更できません/);
  });

  it("休職中のドライバーには割り当てられない", async () => {
    const order = await firstOrder(a, "status = 'unassigned'");
    const [leave] = await sql`select id from drivers where company_id = ${a.companyId} and status = 'leave'`;
    await expect(
      runAsUser(sql, a.adminId, (tx) => tx`update delivery_orders set driver_id = ${leave.id} where id = ${order.id}`),
    ).rejects.toThrow(/休職中/);
  });

  it("完了済みの案件は担当を変えられない", async () => {
    const order = await firstOrder(a, `status = 'delivered' and driver_id <> '${a.driverId}'`);
    await expect(
      runAsUser(sql, a.adminId, (tx) => tx`update delivery_orders set driver_id = ${a.driverId} where id = ${order.id}`),
    ).rejects.toThrow(/変更できません/);
  });

  it("一括投入の設定はログインユーザーからは有効にできない", async () => {
    const order = await firstOrder(a, "status = 'delivered'");
    await expect(
      runAsUser(sql, a.adminId, async (tx) => {
        await tx`select set_config('app.bulk_load', 'on', true)`;
        await tx`update delivery_orders set status = 'assigned' where id = ${order.id}`;
      }),
    ).rejects.toThrow(/変更できません/);
  });
});

describe("集計", () => {
  it("売上は配送完了案件の料金合計と一致する", async () => {
    const [summary] = await runAsUser(sql, a.adminId, (tx) =>
      tx`select revenue, expense, gross_profit from analytics_summary(app.today_jst() - 60, app.today_jst())`);
    const [direct] = await sql`
      select coalesce(sum(fee), 0) revenue from delivery_orders
       where company_id = ${a.companyId} and status = 'delivered'
         and delivery_at >= app.jst_start(app.today_jst() - 60) and delivery_at < app.jst_start(app.today_jst() + 1)`;
    const [exp] = await sql`select coalesce(sum(amount), 0) e from expenses
       where company_id = ${a.companyId} and spent_on between app.today_jst() - 60 and app.today_jst()`;
    expect(Number(summary.revenue)).toBe(Number(direct.revenue));
    expect(Number(summary.expense)).toBe(Number(exp.e));
    expect(Number(summary.gross_profit)).toBe(Number(direct.revenue) - Number(exp.e));
  });

  it("日別・月別・ドライバー別・荷主別の合計が期間合計と一致する", async () => {
    const result = await runAsUser(sql, a.adminId, async (tx) => {
      const [s] = await tx`select revenue from analytics_summary(app.today_jst() - 90, app.today_jst())`;
      const [d] = await tx`select sum(revenue) r from analytics_series(app.today_jst() - 90, app.today_jst(), 'day')`;
      const [w] = await tx`select sum(revenue) r from analytics_series(app.today_jst() - 90, app.today_jst(), 'week')`;
      const [m] = await tx`select sum(revenue) r from analytics_series(app.today_jst() - 90, app.today_jst(), 'month')`;
      const [dr] = await tx`select sum(revenue) r from analytics_by_driver(app.today_jst() - 90, app.today_jst())`;
      const [c] = await tx`select sum(revenue) r from analytics_by_client(app.today_jst() - 90, app.today_jst())`;
      return [s.revenue, d.r, w.r, m.r, dr.r, c.r].map(Number);
    });
    expect(new Set(result).size).toBe(1);
  });

  it("売上0円の期間は粗利益率を null にする（ゼロ除算しない）", async () => {
    const [s] = await runAsUser(sql, a.adminId, (tx) =>
      tx`select revenue, gross_margin from analytics_summary('2000-01-01', '2000-01-31')`);
    expect(Number(s.revenue)).toBe(0);
    expect(s.gross_margin).toBeNull();
  });

  it("ダッシュボードの KPI が返る", async () => {
    const [row] = await runAsUser(sql, a.adminId, (tx) => tx`select dashboard_kpis(app.today_jst()) k`);
    const k = row.k as Record<string, number>;
    expect(k.planned).toBe(k.delivered + k.inProgress + k.notStarted + k.failed);
  });
});

describe("デモ環境", () => {
  it("デモ会社ではドライバー画面に切り替えられ、RLS もドライバー権限になる", async () => {
    await runAsUser(sql, b.adminId, (tx) => tx`select demo_switch_role('driver')`);
    const rows = await runAsUser(sql, b.adminId, (tx) =>
      tx`select count(*)::int n, count(distinct driver_id)::int drivers from delivery_orders`);
    expect(rows[0].drivers).toBe(1);
    await runAsUser(sql, b.adminId, (tx) => tx`select demo_switch_role('admin')`);
    const back = await runAsUser(sql, b.adminId, (tx) => tx`select count(*)::int n from delivery_orders`);
    expect(back[0].n).toBe(b.data.orders.length);
  });

  it("本番の会社ではロールを切り替えられない", async () => {
    await expect(
      runAsUser(sql, a.adminId, (tx) => tx`select demo_switch_role('driver')`),
    ).rejects.toThrow(/デモ環境でのみ/);
  });
});
