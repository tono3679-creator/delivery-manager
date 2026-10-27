/**
 * DB テスト：通知（Phase 4）。
 *   1. 遅延：予定 + 15 分を過ぎた未完了の案件を、1案件につき1回だけ管理者へ通知する。管理者以外は呼べない
 *   2. キャンセル・削除：配車済みの案件が取り消されたら担当ドライバーへ通知する
 *   3. 配送メモ：ドライバー → 管理者、管理者 → 担当ドライバー
 *   4. 会社ごとの削除（デモの期限切れ）で通知の処理が邪魔をしない
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { runAsUser } from "@/lib/db/rls";
import { getNotifications } from "@/lib/data/notifications";
import { connectTyped, createTenant, dropTenant, type TestTenant } from "./helpers";

let sql: Sql;
let a: TestTenant;
let b: TestTenant;

beforeAll(async () => {
  sql = connectTyped();
  const now = new Date();
  a = await createTenant(sql, { seed: 1111, now });
  b = await createTenant(sql, { seed: 1212, now });
});

afterAll(async () => {
  await dropTenant(sql, a);
  await dropTenant(sql, b);
  await sql.end();
});

const asAdminA = <T>(fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, a.adminId, fn);
const asAdminB = <T>(fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, b.adminId, fn);
const asDriverA = <T>(fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, a.driverUserId, fn);

type Notice = { kind: string; title: string; body: string; link: string | null; order_id: string | null; audience: string; driver_id: string | null };
/** RLS を通さずに通知を確かめる */
const noticesFor = (where: { orderId?: string; driverId?: string; kind?: string; after: Date }) => sql<Notice[]>`
  select kind, title, body, link, order_id, audience, driver_id from notifications
   where company_id = ${a.companyId} and created_at >= ${where.after}
     ${where.orderId ? sql`and order_id = ${where.orderId}` : sql``}
     ${where.driverId ? sql`and driver_id = ${where.driverId}` : sql``}
     ${where.kind ? sql`and kind = ${where.kind}` : sql``}
   order by created_at`;

/** 明日以降の配車済みの案件（担当ドライバーつき）を1件 */
async function assignedOrder(driverId?: string, offset = 0) {
  const [o] = await sql<{ id: string; order_no: string; driver_id: string; delivery_name: string }[]>`
    select id, order_no, driver_id, delivery_name from delivery_orders
     where company_id = ${a.companyId} and status = 'assigned' and delivery_at > now() + interval '1 day'
       ${driverId ? sql`and driver_id = ${driverId}` : sql``}
     order by order_no offset ${offset} limit 1`;
  expect(o).toBeDefined();
  return o;
}

describe("遅延の通知", () => {
  it("予定 + 15 分を過ぎた未完了の案件を1回だけ通知し、2回目は何もしない", async () => {
    const order = await assignedOrder();
    // 時間が過ぎた状態を作る（配送予定を1時間前にする）
    await sql`update delivery_orders set pickup_at = now() - interval '2 hours', delivery_at = now() - interval '1 hour' where id = ${order.id}`;
    const start = new Date(Date.now() - 1000);
    const first = await asAdminA((tx) => tx<{ n: number }[]>`select refresh_late_alerts() n`);
    expect(first[0].n).toBeGreaterThanOrEqual(1);
    const second = await asAdminA((tx) => tx<{ n: number }[]>`select refresh_late_alerts() n`);
    expect(second[0].n).toBe(0);

    const late = await noticesFor({ orderId: order.id, kind: "late", after: start });
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ audience: "admin", title: "配送が遅れています", link: `/orders/${order.id}` });
    expect(late[0].body).toContain(order.order_no);

    // 通知の件数は「直近2日の未完了で遅延している案件」と一致する
    const [{ n: lateOrders }] = await sql<{ n: number }[]>`
      select count(*)::int n from delivery_orders
       where company_id = ${a.companyId} and status in ('unassigned','assigned','picked_up','in_transit')
         and delivery_at + interval '15 minutes' < now() and delivery_at > now() - interval '2 days'`;
    const [{ n: notices }] = await sql<{ n: number }[]>`
      select count(*)::int n from notifications where company_id = ${a.companyId} and kind = 'late'`;
    expect(notices).toBe(lateOrders);

    // 管理者の通知一覧に出る
    const list = await asAdminA((tx) => getNotifications(tx, "admin", null));
    expect(list.items.some((i) => i.kind === "late")).toBe(true);
  });

  it("ドライバーは呼べず、他社の遅延は通知しない", async () => {
    await expect(asDriverA((tx) => tx`select refresh_late_alerts()`)).rejects.toThrow(/権限がありません/);
    await asAdminB((tx) => tx`select refresh_late_alerts()`);
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int n from notifications nt join delivery_orders o on o.id = nt.order_id
       where nt.kind = 'late' and nt.company_id <> o.company_id`;
    expect(n).toBe(0);
    // 管理者 B から A の通知は見えない
    const seen = await asAdminB((tx) => tx<{ n: number }[]>`select count(*)::int n from notifications where company_id = ${a.companyId}`);
    expect(seen[0].n).toBe(0);
  });
});

describe("キャンセル・削除の通知", () => {
  it("配車済みの案件をキャンセルすると、担当ドライバーへ理由つきで通知する（割り当て解除の通知は重ねない）", async () => {
    const order = await assignedOrder();
    const start = new Date(Date.now() - 1000);
    await asAdminA((tx) => tx`select admin_update_status(${order.id}, 'assigned', 'cancelled', '荷主都合で中止')`);
    const notices = await noticesFor({ orderId: order.id, after: start });
    expect(notices.map((n) => n.kind)).toEqual(["cancelled"]);
    expect(notices[0]).toMatchObject({ audience: "driver", driver_id: order.driver_id, title: "配送がキャンセルされました" });
    expect(notices[0].body).toContain("荷主都合で中止");
  });

  it("配車済みの案件を削除すると、担当ドライバーへ通知する", async () => {
    const order = await assignedOrder(undefined, 1);
    const start = new Date(Date.now() - 1000);
    await asAdminA((tx) => tx`delete from delivery_orders where id = ${order.id}`);
    const notices = await noticesFor({ driverId: order.driver_id, kind: "cancelled", after: start });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ title: "配送が取り消されました", order_id: null, link: null });
    expect(notices[0].body).toContain(order.order_no);
  });
});

describe("配送メモの通知", () => {
  it("ドライバーのメモは管理者へ、管理者のメモは担当ドライバーへ届く", async () => {
    const order = await assignedOrder(a.driverId);
    const start = new Date(Date.now() - 1000);
    await asDriverA((tx) => tx`
      insert into delivery_notes (company_id, order_id, author_id, author_name, body)
      values (${a.companyId}, ${order.id}, ${a.driverUserId}, 'テストドライバー', '搬入口が工事中のため
正面から納品します')`);
    await asAdminA((tx) => tx`
      insert into delivery_notes (company_id, order_id, author_id, author_name, body)
      values (${a.companyId}, ${order.id}, ${a.adminId}, 'テスト管理者', '受領印を忘れずにお願いします')`);
    const notices = await noticesFor({ orderId: order.id, kind: "note", after: start });
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({ audience: "admin", title: "テストドライバーさんからメモが届きました", link: `/orders/${order.id}` });
    // 改行はまとめて1行で表示する
    expect(notices[0].body).toBe(`${order.order_no} 搬入口が工事中のため 正面から納品します`);
    expect(notices[1]).toMatchObject({ audience: "driver", driver_id: a.driverId, title: "管理者からメモが届きました", link: `/driver/orders/${order.id}` });

    // それぞれの画面の通知一覧に出る（RLS）
    const [admin, driver] = await Promise.all([
      asAdminA((tx) => getNotifications(tx, "admin", null)),
      asDriverA((tx) => getNotifications(tx, "driver", a.driverId)),
    ]);
    expect(admin.items.some((i) => i.kind === "note" && i.link === `/orders/${order.id}`)).toBe(true);
    expect(driver.items.some((i) => i.kind === "note" && i.link === `/driver/orders/${order.id}`)).toBe(true);
  });
});

describe("会社ごとの削除", () => {
  it("配車済みの案件がある会社を削除しても、削除の通知が邪魔をしない", async () => {
    const c = await createTenant(sql, { seed: 1313, now: new Date() });
    await dropTenant(sql, c);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from notifications where company_id = ${c.companyId}`;
    expect(n).toBe(0);
  });
});
