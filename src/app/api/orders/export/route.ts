import { NextResponse, type NextRequest } from "next/server";
import { adminApiGuard, asAdmin } from "@/lib/auth";
import { toCsv } from "@/lib/csv/csv";
import { compactDate, csvResponse } from "@/lib/csv/download";
import { formatCsvDateTime, ORDER_EXPORT_HEADER } from "@/lib/csv/orders";
import { todayJst } from "@/lib/date";
import { exportOrders, ORDER_EXPORT_LIMIT, parseOrderFilters } from "@/lib/data/orders";
import { ORDER_STATUS_LABEL } from "@/lib/domain/status";

/**
 * 配送案件の CSV 書き出し。一覧と同じ検索条件（URL のクエリ）で、配送予定の古い順に出力する。
 * 管理者のみ（RLS により自社の案件だけ）。書き出したことは操作履歴に残す。
 */
export async function GET(request: NextRequest) {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const filters = parseOrderFilters(Object.fromEntries(request.nextUrl.searchParams));
  // ページ・並び順は書き出しに関係しない
  const conditions = { ...filters, page: undefined, sort: undefined, dir: undefined };

  const result = await asAdmin(async (tx, user) => {
    const data = await exportOrders(tx, conditions);
    if (data.total > ORDER_EXPORT_LIMIT) return { tooMany: data.total, rows: [] };
    await tx`insert into audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
             values (${user.companyId}, ${user.userId}, ${user.displayName}, 'export', 'delivery_order', null,
                     ${tx.json({ count: data.rows.length, filters: conditions })})`;
    return { tooMany: null, rows: data.rows };
  });

  if (result.tooMany !== null) {
    return NextResponse.json(
      { error: `書き出せるのは ${ORDER_EXPORT_LIMIT.toLocaleString("ja-JP")} 件までです（${result.tooMany.toLocaleString("ja-JP")} 件あります）。期間などで絞り込んでください` },
      { status: 422 },
    );
  }

  const body = toCsv(
    ORDER_EXPORT_HEADER,
    result.rows.map((o) => [
      o.orderNo, o.clientCode, o.clientName, o.pickupAddress, o.deliveryName, o.deliveryAddress,
      formatCsvDateTime(o.pickupAt), formatCsvDateTime(o.deliveryAt), o.driverName, o.vehiclePlate,
      o.cargoType, o.quantity, o.fee, ORDER_STATUS_LABEL[o.status], o.isLate ? "遅延" : "",
      formatCsvDateTime(o.completedAt), o.invoiceNo, o.notes, formatCsvDateTime(o.createdAt), formatCsvDateTime(o.updatedAt),
    ]),
  );
  const day = compactDate(todayJst());
  return csvResponse(body, `配送案件_${day}.csv`, `orders_${day}.csv`, result.rows.length);
}
