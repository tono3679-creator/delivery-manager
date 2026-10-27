import Link from "next/link";
import { PackageSearch } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { SortLink } from "@/components/common/sort-link";
import { LateBadge, StatusBadge } from "@/components/common/status-badge";
import { ExportOrdersButton } from "@/components/orders/export-orders-button";
import { ImportOrdersButton } from "@/components/orders/import-orders-dialog";
import { NewOrderButton } from "@/components/orders/new-order-button";
import { OrderFilters } from "@/components/orders/order-filters";
import { OrderRowActions } from "@/components/orders/order-row-actions";
import { asAdmin } from "@/lib/auth";
import { addDays, todayJst } from "@/lib/date";
import {
  getFormOptions, listOrders, ORDER_EXPORT_LIMIT, PAGE_SIZE, parseOrderFilters, type OrderFilters as Filters, type OrderSort,
} from "@/lib/data/orders";
import { formatDateShort, formatNumber, formatTime, formatYen } from "@/lib/format";
import { withParams } from "@/lib/url";

export const metadata = { title: "配送案件" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseOrderFilters(await searchParams);
  const today = todayJst();
  const { list, options } = await asAdmin(async (tx) => {
    const [list, options] = await Promise.all([listOrders(tx, filters), getFormOptions(tx)]);
    return { list, options };
  });

  // URL に残す検索条件（ページ番号以外）
  const current: Record<string, string | number | undefined> = { ...filters, page: filters.page };
  const sortHref = (key: OrderSort) => {
    const active = (filters.sort ?? "delivery_at") === key;
    const dir = active ? ((filters.dir ?? (filters.sort ? "asc" : "desc")) === "asc" ? "desc" : "asc") : "asc";
    return withParams("/orders", current, { sort: key, dir, page: undefined });
  };
  const sortState = (key: OrderSort) => ({
    active: (filters.sort ?? "delivery_at") === key,
    dir: (filters.dir ?? (filters.sort ? "asc" : "desc")) as "asc" | "desc",
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="配送案件"
        description="案件の検索・登録・編集ができます。ドライバーを選んで登録すると、すぐにドライバー画面へ届きます。"
        actions={
          <>
            <ExportOrdersButton
              href={withParams("/api/orders/export", current, { page: undefined, sort: undefined, dir: undefined })}
              total={list.total}
              limit={ORDER_EXPORT_LIMIT}
            />
            <ImportOrdersButton />
            <NewOrderButton options={options} defaultDay={addDays(today, 1)} />
          </>
        }
      />

      <Card>
        <OrderFilters clients={options.clients} drivers={options.drivers} today={today} />
        <SummaryBar total={list.total} deliveredFee={list.deliveredFee} filters={filters} />

        {list.rows.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="条件に合う案件はありません"
            description="検索条件を変えるか、「条件をクリア」で絞り込みを解除してください。"
          />
        ) : (
          <>
            {/* PC：表 */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5"><SortLink label="案件ID" href={sortHref("order_no")} {...sortState("order_no")} /></TableHead>
                    <TableHead><SortLink label="配送予定" href={sortHref("delivery_at")} {...sortState("delivery_at")} /></TableHead>
                    <TableHead>荷主</TableHead>
                    <TableHead>配送先</TableHead>
                    <TableHead>担当</TableHead>
                    <TableHead><SortLink label="ステータス" href={sortHref("status")} {...sortState("status")} /></TableHead>
                    <TableHead className="text-right"><SortLink label="料金" href={sortHref("fee")} {...sortState("fee")} /></TableHead>
                    <TableHead className="w-12 pr-5"><span className="sr-only">操作</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.rows.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="pl-5">
                        <Link href={`/orders/${o.id}`} className="font-medium text-brand tabular hover:underline">{o.orderNo}</Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular">
                        <div>{formatDateShort(o.deliveryAt)}</div>
                        <div className="text-xs text-muted-foreground">{formatTime(o.pickupAt)}〜{formatTime(o.deliveryAt)}</div>
                      </TableCell>
                      <TableCell className="max-w-40 truncate">{o.clientName}</TableCell>
                      <TableCell className="max-w-64">
                        <div className="truncate">{o.deliveryName}</div>
                        <div className="truncate text-xs text-muted-foreground">{o.deliveryAddress}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {o.driverName ?? <span className="text-muted-foreground">—</span>}
                        {o.vehiclePlate && <div className="text-xs text-muted-foreground">{o.vehiclePlate}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge status={o.status} />
                          {o.isLate && <LateBadge />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular">{formatYen(o.fee)}</TableCell>
                      <TableCell className="pr-5">
                        <OrderRowActions id={o.id} orderNo={o.orderNo} status={o.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* スマホ：カード */}
            <ul className="divide-y md:hidden">
              {list.rows.map((o) => (
                <li key={o.id} className="flex items-start gap-2 px-4 py-3">
                  <Link href={`/orders/${o.id}`} className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-brand tabular">{o.orderNo}</span>
                      <span className="text-sm tabular">{formatYen(o.fee)}</span>
                    </div>
                    <p className="truncate font-medium">{o.deliveryName}</p>
                    <p className="truncate text-xs text-muted-foreground">{o.clientName}・{o.driverName ?? "未割当"}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={o.status} />
                      {o.isLate && <LateBadge />}
                      <span className="text-xs text-muted-foreground tabular">
                        {formatDateShort(o.deliveryAt)} {formatTime(o.pickupAt)}〜{formatTime(o.deliveryAt)}
                      </span>
                    </div>
                  </Link>
                  <OrderRowActions id={o.id} orderNo={o.orderNo} status={o.status} />
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="border-t">
          <Pagination
            page={list.page}
            pageCount={list.pageCount}
            total={list.total}
            pageSize={PAGE_SIZE}
            hrefFor={(page) => withParams("/orders", current, { page: page === 1 ? undefined : page })}
          />
        </div>
      </Card>
    </div>
  );
}

function SummaryBar({ total, deliveredFee, filters }: { total: number; deliveredFee: number; filters: Filters }) {
  const tags = [
    filters.scope === "active" && "対応中のみ",
    filters.late && "遅延のみ",
  ].filter(Boolean) as string[];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b bg-muted/40 px-4 py-2.5 text-sm sm:px-5">
      <span>
        該当 <strong className="tabular">{formatNumber(total)}</strong> 件
      </span>
      <span className="text-muted-foreground">
        うち配送完了の売上 <strong className="text-foreground tabular">{formatYen(deliveredFee)}</strong>
      </span>
      {tags.map((t) => <Badge key={t} variant="neutral">{t}</Badge>)}
    </div>
  );
}
