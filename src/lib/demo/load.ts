/**
 * 生成したデモデータを DB に一括登録する。
 * データベース所有者の接続で実行し、トランザクション内で app.bulk_load を有効にして
 * トリガーによる検証・履歴作成を止める（履歴は生成済みのものを入れるため）。
 */
import type { Sql, TransactionSql } from "postgres";
import type { DemoDataset } from "./generator";

type Row = Record<string, unknown>;

const CHUNK = 1000;

async function insertRows(tx: TransactionSql, table: string, rows: Row[]) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    // postgres.js の sql(rows, columns) で複数行 INSERT を組み立てる
    await tx`insert into ${tx(table)} ${tx(chunk as Record<string, never>[], columns)}`;
  }
}

/** データセットを登録する。既に同じ ID の会社があれば先に削除する。 */
export async function loadDataset(sql: Sql, data: DemoDataset, extra?: (tx: TransactionSql) => Promise<void>) {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.bulk_load', 'on', true)`;
    await tx`delete from public.companies where id = ${data.company.id as string}`;
    await insertRows(tx, "companies", [data.company]);
    await insertRows(tx, "offices", data.offices);
    await insertRows(tx, "drivers", data.drivers);
    await insertRows(tx, "vehicles", data.vehicles);
    await insertRows(tx, "vehicle_assignments", data.vehicleAssignments);
    await insertRows(tx, "clients", data.clients);
    await insertRows(tx, "client_invoices", data.invoices);
    await insertRows(tx, "delivery_orders", data.orders);
    await insertRows(tx, "delivery_status_logs", data.statusLogs);
    await insertRows(tx, "delivery_notes", data.notes);
    await insertRows(tx, "expenses", data.expenses);
    await insertRows(tx, "notifications", data.notifications);
    await insertRows(tx, "audit_logs", data.auditLogs);
    if (extra) await extra(tx);
    await tx`select set_config('app.bulk_load', 'off', true)`;
  });
}
