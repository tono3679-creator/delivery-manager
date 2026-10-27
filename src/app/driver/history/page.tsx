import { History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { Pagination } from "@/components/common/pagination";
import { DriverOrderCardLink } from "@/components/driver/order-card";
import { HistoryFilters } from "@/components/driver/history-filters";
import { asDriver } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { getDriverHistory, HISTORY_PAGE_SIZE, parseHistoryFilters } from "@/lib/data/driver";
import { formatDate, formatNumber } from "@/lib/format";
import { withParams } from "@/lib/url";

export const metadata = { title: "配送履歴" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DriverHistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseHistoryFilters(await searchParams);
  const today = todayJst();
  const history = await asDriver((tx) => getDriverHistory(tx, today, filters));
  const current = { from: filters.from, to: filters.to, status: filters.status };

  return (
    <div className="space-y-4 pt-2">
      <div>
        <h1 className="text-xl font-bold">配送履歴</h1>
        <p className="text-sm text-muted-foreground tabular">
          {formatDate(history.from)}〜{formatDate(history.to)}・{formatNumber(history.total)}件（完了 {formatNumber(history.delivered)}件）
        </p>
      </div>
      <HistoryFilters from={history.from} to={history.to} status={filters.status} today={today} />
      {history.rows.length === 0 ? (
        <Card><EmptyState icon={History} title="該当する履歴はありません" description="期間やステータスを変えてください。" /></Card>
      ) : (
        <div className="grid gap-2">
          {history.rows.map((o) => <DriverOrderCardLink key={o.id} order={o} showDate />)}
        </div>
      )}
      <Pagination
        page={history.page}
        pageCount={history.pageCount}
        total={history.total}
        pageSize={HISTORY_PAGE_SIZE}
        hrefFor={(page) => withParams("/driver/history", current, { page: page === 1 ? undefined : page })}
      />
    </div>
  );
}
