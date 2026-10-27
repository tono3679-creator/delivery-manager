/**
 * DB テスト：Phase 2（案件一覧の検索・ページ送り、配車ボード、ドライバー画面のデータ、配車変更の通知）。
 * 画面が使うデータ取得関数（src/lib/data）を、実際の RLS の権限で呼び出して確認する。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { runAsUser } from "@/lib/db/rls";
import { getDispatchBoard } from "@/lib/data/dispatch";
import { getDriverDay, getDriverHistory, getDriverOrder } from "@/lib/data/driver";
import { findDriverConflicts, listOrders, PAGE_SIZE, parseOrderFilters } from "@/lib/data/orders";
import { addDays, todayJst } from "@/lib/date";
import { connectTyped, createTenant, dropTenant, type TestTenant } from "./helpers";

let sql: Sql;
let a: TestTenant;
let b: TestTenant;
const today = todayJst();

beforeAll(async () => {
  sql = connectTyped();
  const now = new Date();
  a = await createTenant(sql, { seed: 303, now });
  b = await createTenant(sql, { seed: 404, now });
});

afterAll(async () => {
  await dropTenant(sql, a);
  await dropTenant(sql, b);
  await sql.end();
});

type O = { id: string; orderNo: string; clientId: string; driverId: string | null; status: string; pickupAt: Date; deliveryAt: Date; fee: number };
const orders = (t: TestTenant): O[] => t.data.orders.map((r) => ({
  id: r.id as string, orderNo: r.order_no as string, clientId: r.client_id as string, driverId: (r.driver_id as string | null) ?? null,
  status: r.status as string, pickupAt: new Date(r.pickup_at as Date), deliveryAt: new Date(r.delivery_at as Date), fee: Number(r.fee),
}));

const asAdminA = <T>(fn: Parameters<typeof runAsUser<T>>[2]) => runAsUser(sql, a.adminId, fn);
const asDriverA = <T>(fn: Parameters<typeof runAsUser<T>>[2]) => runAsUser(sql, a.driverUserId, fn);

describe("案件一覧（サーバー側で検索・ページ送り）", () => {
  it("1ページ分だけ取得し、件数は自社の全件と一致する", async () => {
    const list = await asAdminA((tx) => listOrders(tx, parseOrderFilters({})));
    expect(list.rows.length).toBe(PAGE_SIZE);
    expect(list.total).toBe(a.data.orders.length);
    expect(list.pageCount).toBe(Math.ceil(a.data.orders.length / PAGE_SIZE));
  });

  it("ステータス・期間・荷主で絞り込める", async () => {
    const client = a.data.clients[0].id as string;
    const from = addDays(today, -14);
    const list = await asAdminA((tx) => listOrders(tx, parseOrderFilters({ status: "delivered", from, to: today, client })));
    const expected = orders(a).filter((o) =>
      o.status === "delivered" && o.clientId === client
      && o.deliveryAt >= new Date(`${from}T00:00:00+09:00`) && o.deliveryAt < new Date(`${addDays(today, 1)}T00:00:00+09:00`));
    expect(list.total).toBe(expected.length);
    expect(list.rows.every((r) => r.status === "delivered" && r.clientId === client)).toBe(true);
    expect(list.deliveredFee).toBe(expected.reduce((s, o) => s + o.fee, 0));
  });

  it("案件ID のキーワード検索・料金の並び替え・ページ指定", async () => {
    const target = orders(a)[100];
    const found = await asAdminA((tx) => listOrders(tx, parseOrderFilters({ q: target.orderNo })));
    expect(found.rows.map((r) => r.orderNo)).toContain(target.orderNo);

    const sorted = await asAdminA((tx) => listOrders(tx, parseOrderFilters({ sort: "fee", dir: "asc", page: "2" })));
    const fees = sorted.rows.map((r) => r.fee);
    expect(fees).toEqual([...fees].sort((x, y) => x - y));
    expect(sorted.page).toBe(2);
  });

  it("不正な検索条件は無視する（SQL に混ざらない）", async () => {
    const f = parseOrderFilters({ sort: "fee; drop table delivery_orders", status: "unknown", page: "-3", q: "%' or 1=1 --" });
    expect(f.sort).toBeUndefined();
    expect(f.status).toBeUndefined();
    expect(f.page).toBeUndefined();
    const list = await asAdminA((tx) => listOrders(tx, f));
    expect(list.total).toBe(0);
  });

  it("他社の案件は検索に出てこない", async () => {
    const other = orders(b)[0];
    const list = await asAdminA((tx) => listOrders(tx, parseOrderFilters({ q: other.orderNo })));
    expect(list.rows.some((r) => r.id === other.id)).toBe(false);
  });

  it("遅延のみ：予定を過ぎて未完了、または遅れて完了した案件だけ", async () => {
    const list = await asAdminA((tx) => listOrders(tx, parseOrderFilters({ late: "1" })));
    expect(list.total).toBeGreaterThan(0);
    expect(list.rows.every((r) => r.isLate)).toBe(true);
  });
});

describe("配車ボード", () => {
  it("指定日の案件（キャンセル以外）と退職者以外のドライバーを返す", async () => {
    const day = addDays(today, 1);
    const board = await asAdminA((tx) => getDispatchBoard(tx, day));
    const start = new Date(`${day}T00:00:00+09:00`).getTime();
    const end = start + 86_400_000;
    expect(board.orders.length).toBeGreaterThan(0);
    for (const o of board.orders) {
      expect(o.status).not.toBe("cancelled");
      expect(new Date(o.pickupAt).getTime()).toBeLessThan(end);
      expect(new Date(o.deliveryAt).getTime()).toBeGreaterThanOrEqual(start);
    }
    expect(board.drivers.length).toBe(a.data.drivers.filter((d) => d.status !== "retired").length);
  });

  it("重複チェックは同じドライバーの有効な案件だけを対象にする", async () => {
    const o = orders(a).find((x) => x.status === "assigned" && x.driverId)!;
    const conflicts = await asAdminA((tx) => findDriverConflicts(tx, o.driverId!, o.pickupAt, o.deliveryAt, o.id));
    for (const c of conflicts) {
      expect(c.id).not.toBe(o.id);
      expect(c.pickup_at.getTime()).toBeLessThan(o.deliveryAt.getTime());
      expect(c.delivery_at.getTime()).toBeGreaterThan(o.pickupAt.getTime());
    }
  });
});

describe("ドライバー画面のデータ", () => {
  it("本日の配送は自分の担当だけ", async () => {
    const day = await asDriverA((tx) => getDriverDay(tx, today));
    const mine = orders(a).filter((o) => o.driverId === a.driverId && o.status !== "cancelled"
      && o.deliveryAt >= new Date(`${today}T00:00:00+09:00`) && o.deliveryAt < new Date(`${addDays(today, 1)}T00:00:00+09:00`));
    expect(day.map((o) => o.id).sort()).toEqual(mine.map((o) => o.id).sort());
  });

  it("他のドライバーの案件は詳細を開けない（存在しない扱い）", async () => {
    const other = orders(a).find((o) => o.driverId && o.driverId !== a.driverId)!;
    expect(await asDriverA((tx) => getDriverOrder(tx, other.id))).toBeNull();
    const own = orders(a).find((o) => o.driverId === a.driverId)!;
    const detail = await asDriverA((tx) => getDriverOrder(tx, own.id));
    expect(detail?.orderNo).toBe(own.orderNo);
  });

  it("配送履歴は今日までの自分の案件を新しい順に返す", async () => {
    const h = await asDriverA((tx) => getDriverHistory(tx, today, {}));
    expect(h.rows.length).toBeGreaterThan(0);
    const times = h.rows.map((r) => r.deliveryAt.getTime());
    expect(times).toEqual([...times].sort((x, y) => y - x));
    const ids = new Set(orders(a).filter((o) => o.driverId === a.driverId).map((o) => o.id));
    expect(h.rows.every((r) => ids.has(r.id))).toBe(true);
  });
});

describe("配車変更の通知", () => {
  async function newAssignedOrder(driverId: string) {
    const client = a.data.clients[1].id as string;
    const pickup = new Date(Date.now() + 2 * 86_400_000);
    const [row] = await asAdminA((tx) => tx<{ id: string }[]>`
      insert into delivery_orders (company_id, client_id, pickup_address, delivery_name, delivery_address,
        pickup_at, delivery_at, driver_id, cargo_type, quantity, fee)
      values (${a.companyId}, ${client}, '東京都港区芝浦1-1-1', '通知テスト', '東京都港区海岸1-1-1',
        ${pickup}, ${new Date(pickup.getTime() + 3600_000)}, ${driverId}, '書類', 1, 3000)
      returning id`);
    return row.id;
  }
  const kinds = (orderId: string, driverId: string) => sql<{ kind: string; title: string }[]>`
    select kind, title from notifications
     where driver_id = ${driverId} and body like (select order_no || '%' from delivery_orders where id = ${orderId})
     order by created_at`;

  const activeDrivers = () => a.data.drivers.filter((d) => d.status === "active").map((d) => d.id as string);

  it("担当を変えると、新しい担当に「割り当て」、前の担当に「解除」を通知する", async () => {
    const [x, y] = activeDrivers();
    const id = await newAssignedOrder(x);
    await asAdminA((tx) => tx`update delivery_orders set driver_id = ${y}, vehicle_id = null where id = ${id}`);
    expect((await kinds(id, x)).map((n) => n.kind)).toEqual(["assigned", "unassigned"]);
    expect((await kinds(id, y)).map((n) => n.kind)).toEqual(["assigned"]);
  });

  it("担当のまま時刻を変えると「時刻変更」を通知する", async () => {
    const [x] = activeDrivers();
    const id = await newAssignedOrder(x);
    await asAdminA((tx) => tx`update delivery_orders set pickup_at = pickup_at + interval '30 minutes',
      delivery_at = delivery_at + interval '30 minutes' where id = ${id}`);
    expect((await kinds(id, x)).map((n) => n.kind)).toEqual(["assigned", "rescheduled"]);
  });

  it("配送失敗から再配達（配車済）に戻すと担当に再度通知する", async () => {
    const [x] = activeDrivers();
    const id = await newAssignedOrder(x);
    for (const [from, to, note] of [["assigned", "picked_up", null], ["picked_up", "failed", "受取人不在"], ["failed", "assigned", null]]) {
      await asAdminA((tx) => tx`select admin_update_status(${id}, ${from}, ${to}, ${note})`);
    }
    const titles = (await kinds(id, x)).map((n) => n.title);
    expect(titles).toEqual(["新しい配送が割り当てられました", "再配達が割り当てられました"]);
  });
});
