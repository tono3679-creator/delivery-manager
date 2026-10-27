/**
 * 性能の確認（ローカル専用）。
 * 会社を増やして本番に近い件数にしたうえで、各画面のデータ取得を管理者・ドライバーの権限（RLS）で実行し、時間を測る。
 *   npx tsx --conditions=react-server scripts/dev/perf.ts [追加する会社数=15]
 * 追加した会社は最後に削除する。
 */
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { generateDemoData } from "@/lib/demo/generator";
import { loadDataset } from "@/lib/demo/load";
import { runAsUser } from "@/lib/db/rls";
import { DB_TYPES } from "@/lib/db/types";
import { todayJst } from "@/lib/date";
import { getAnalytics, resolvePeriod, listExpenses, parseExpenseFilters } from "@/lib/data/analytics";
import { listClients, getClientDetail } from "@/lib/data/clients";
import { getDashboardAlerts, getDashboardKpis, getDashboardSeries, getTodayOrders, getDriverPerformance, getClientRanking } from "@/lib/data/dashboard";
import { getDispatchBoard } from "@/lib/data/dispatch";
import { getDriverDay, getDriverHistory, getDriverMonthStats, getDriverUpcoming, parseHistoryFilters } from "@/lib/data/driver";
import { listDrivers, getDriverDetail } from "@/lib/data/drivers";
import { getMapOrders } from "@/lib/data/map";
import { getNotifications } from "@/lib/data/notifications";
import { exportOrders, getOrderDetail, listOrders, parseOrderFilters } from "@/lib/data/orders";
import { listAuditLogs } from "@/lib/data/settings";
import { listVehicles, parseVehicleFilters } from "@/lib/data/vehicles";
import { startOfMonth } from "@/lib/date";

const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/dm";
const extra = Number(process.argv[2] ?? 15);
const sql = postgres(url, { max: 4, prepare: false, onnotice: () => {}, types: DB_TYPES });

async function main() {
  const now = new Date();
  const today = todayJst();
  const added: string[] = [];
  const users: string[] = [];
  let target: { companyId: string; adminId: string; driverUserId: string; driverId: string; orderId: string; clientId: string } | null = null;
  try {
    for (let i = 0; i < extra + 1; i++) {
      const companyId = randomUUID();
      const adminId = randomUUID();
      const driverUserId = randomUUID();
      const data = generateDemoData({ seed: 9000 + i, now, companyId, isDemo: true, demoOwner: adminId, demoExpiresAt: new Date(Date.now() + 3600_000) });
      await loadDataset(sql, data, async (tx) => {
        await tx`insert into auth.users (id, email, is_anonymous) values (${adminId}, null, true), (${driverUserId}, null, true)`;
        await tx`insert into profiles (id, company_id, role, driver_id, display_name) values
          (${adminId}, ${companyId}, 'admin', null, '性能確認'), (${driverUserId}, ${companyId}, 'driver', ${data.featuredDriverId}, '性能確認ドライバー')`;
      });
      added.push(companyId);
      users.push(adminId, driverUserId);
      if (!target) {
        target = { companyId, adminId, driverUserId, driverId: data.featuredDriverId, orderId: data.orders[data.orders.length - 100].id as string, clientId: data.clients[0].id as string };
      }
    }
    await sql`analyze`;
    const [{ orders, companies }] = await sql<{ orders: number; companies: number }[]>`
      select (select count(*)::int from delivery_orders) orders, (select count(*)::int from companies) companies`;
    console.log(`会社 ${companies} 社 / 案件 ${orders.toLocaleString()} 件で計測（対象の会社は約 6,300 件）\n`);

    const t = target!;
    const admin = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) => runAsUser(sql, t.adminId, fn);
    const driver = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) => runAsUser(sql, t.driverUserId, fn);
    const period = (p: Record<string, string>) => resolvePeriod(p, today);
    const cases: [string, () => Promise<unknown>][] = [
      ["ダッシュボード KPI", () => admin((tx) => getDashboardKpis(tx, today))],
      ["ダッシュボード グラフ", () => admin((tx) => getDashboardSeries(tx, today))],
      ["ダッシュボード 本日の案件", () => admin((tx) => getTodayOrders(tx, today))],
      ["ダッシュボード 注意事項", () => admin((tx) => getDashboardAlerts(tx, today))],
      ["ダッシュボード ランキング", () => admin(async (tx) => Promise.all([getDriverPerformance(tx, startOfMonth(today), today), getClientRanking(tx, startOfMonth(today), today)]))],
      ["案件一覧（既定）", () => admin((tx) => listOrders(tx, parseOrderFilters({})))],
      ["案件一覧（キーワード検索）", () => admin((tx) => listOrders(tx, parseOrderFilters({ q: "倉庫" })))],
      ["案件一覧（遅延・最終ページ）", () => admin((tx) => listOrders(tx, parseOrderFilters({ late: "1", page: "50" })))],
      ["案件詳細", () => admin((tx) => getOrderDetail(tx, t.orderId))],
      ["CSV 書き出し（全件）", () => admin((tx) => exportOrders(tx, parseOrderFilters({})))],
      ["配車ボード", () => admin((tx) => getDispatchBoard(tx, today))],
      ["配送マップ", () => admin((tx) => getMapOrders(tx, today))],
      ["売上分析（今月）", () => admin((tx) => getAnalytics(tx, period({})))],
      ["売上分析（6か月）", () => admin((tx) => getAnalytics(tx, period({ period: "6m" })))],
      ["経費一覧", () => admin((tx) => listExpenses(tx, period({}), parseExpenseFilters({})))],
      ["ドライバー一覧", () => admin((tx) => listDrivers(tx, {}, today))],
      ["ドライバー詳細", () => admin((tx) => getDriverDetail(tx, t.driverId, today))],
      ["車両一覧", () => admin((tx) => listVehicles(tx, parseVehicleFilters({}), today))],
      ["荷主一覧", () => admin((tx) => listClients(tx, {}, today))],
      ["荷主詳細", () => admin((tx) => getClientDetail(tx, t.clientId, today))],
      ["通知", () => admin((tx) => getNotifications(tx, "admin", null))],
      ["遅延の通知の更新", () => admin((tx) => tx`select refresh_late_alerts()`)],
      ["操作履歴", () => admin((tx) => listAuditLogs(tx, { log: "", page: 1 }))],
      ["ドライバー 本日", () => driver((tx) => Promise.all([getDriverDay(tx, today), getDriverUpcoming(tx, today), getDriverMonthStats(tx, today)]))],
      ["ドライバー 履歴", () => driver((tx) => getDriverHistory(tx, today, parseHistoryFilters({})))],
      ["ドライバー 地図", () => driver((tx) => getMapOrders(tx, today, t.driverId))],
    ];
    console.log("画面のデータ".padEnd(24, "　"), "  1回目   中央値（5回）");
    for (const [label, run] of cases) {
      const times: number[] = [];
      for (let i = 0; i < 6; i++) {
        const t0 = performance.now();
        await run();
        times.push(performance.now() - t0);
      }
      const warm = times.slice(1).sort((a, b) => a - b)[2];
      console.log(label.padEnd(20, "　"), `${times[0].toFixed(0).padStart(5)}ms ${warm.toFixed(0).padStart(6)}ms`);
    }
  } finally {
    if (added.length) await sql`delete from companies where id in ${sql(added)}`;
    if (users.length) await sql`delete from auth.users where id in ${sql(users)}`;
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
