import { Receipt } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Muted } from "@/components/common/detail";
import { EmptyState } from "@/components/common/empty-state";
import { ListFilters } from "@/components/common/list-filters";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { ExpenseRowActions, NewExpenseButton } from "@/components/analytics/expense-form";
import { PeriodFilter } from "@/components/analytics/period-filter";
import { asAdmin } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { EXPENSE_PAGE_SIZE, getExpenseFormOptions, listExpenses, parseExpenseFilters, resolvePeriod } from "@/lib/data/analytics";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL } from "@/lib/domain/labels";
import { formatDate, formatNumber, formatYen } from "@/lib/format";
import { withParams } from "@/lib/url";

export const metadata = { title: "経費の一覧・登録" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ExpensesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const today = todayJst();
  const period = resolvePeriod(params, today);
  const filters = parseExpenseFilters(params);
  const { list, options } = await asAdmin(async (tx) => {
    const [list, options] = await Promise.all([listExpenses(tx, period, filters), getExpenseFormOptions(tx)]);
    return { list, options };
  });
  const keep = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const current = { period: keep("period"), from: keep("from"), to: keep("to"), category: filters.category };
  const navQuery = new URLSearchParams(
    Object.entries({ period: current.period, from: current.from, to: current.to }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  return (
    <div className="space-y-5">
      <PageHeader
        title="経費の一覧・登録"
        description="燃料費・高速道路料金・人件費などを登録します。登録した経費は粗利益の計算に使われます。"
        actions={
          <>
            <AnalyticsNav current="expenses" query={navQuery} />
            <NewExpenseButton options={options} today={today} />
          </>
        }
      />

      <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <PeriodFilter preset={period.preset} from={period.from} to={period.to} today={today} />
        <p className="text-sm font-medium tabular">{formatDate(period.from)}〜{formatDate(period.to)}</p>
      </Card>

      <Card>
        <ListFilters
          showSearch={false}
          selects={[{
            key: "category", label: "カテゴリ", allLabel: "すべてのカテゴリ",
            options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABEL[c] })),
          }]}
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b bg-muted/40 px-4 py-2.5 text-sm sm:px-5">
          <span>該当 <strong className="tabular">{formatNumber(list.total)}</strong> 件</span>
          <span className="text-muted-foreground">合計 <strong className="text-foreground tabular">{formatYen(list.amount)}</strong></span>
        </div>

        {list.rows.length === 0 ? (
          <EmptyState icon={Receipt} title="この期間の経費はありません" description="期間やカテゴリを変えるか、「経費を登録」から追加してください。" />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">日付</TableHead>
                    <TableHead>カテゴリ</TableHead>
                    <TableHead>内容</TableHead>
                    <TableHead>ドライバー</TableHead>
                    <TableHead>車両</TableHead>
                    <TableHead className="text-right">金額</TableHead>
                    <TableHead className="w-12 pr-5"><span className="sr-only">操作</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.rows.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="pl-5 tabular whitespace-nowrap">{formatDate(e.spentOn)}</TableCell>
                      <TableCell className="whitespace-nowrap">{EXPENSE_CATEGORY_LABEL[e.category]}</TableCell>
                      <TableCell className="max-w-64 truncate">{e.description ?? <Muted />}</TableCell>
                      <TableCell className="whitespace-nowrap">{e.driverName ?? <Muted />}</TableCell>
                      <TableCell className="whitespace-nowrap">{e.vehiclePlate ?? <Muted />}</TableCell>
                      <TableCell className="text-right tabular">{formatYen(e.amount)}</TableCell>
                      <TableCell className="pr-5">
                        <ExpenseRowActions
                          today={today}
                          options={options}
                          expense={{
                            id: e.id, spentOn: e.spentOn, category: e.category, amount: e.amount,
                            driverId: e.driverId ?? "", vehicleId: e.vehicleId ?? "", description: e.description ?? "",
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {list.rows.map((e) => (
                <li key={e.id} className="flex items-start gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{EXPENSE_CATEGORY_LABEL[e.category]}</span>
                      <span className="text-sm tabular">{formatYen(e.amount)}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDate(e.spentOn)}{e.description && `・${e.description}`}
                    </p>
                    {(e.driverName || e.vehiclePlate) && (
                      <p className="truncate text-xs text-muted-foreground">{[e.driverName, e.vehiclePlate].filter(Boolean).join("・")}</p>
                    )}
                  </div>
                  <ExpenseRowActions
                    today={today}
                    options={options}
                    expense={{
                      id: e.id, spentOn: e.spentOn, category: e.category, amount: e.amount,
                      driverId: e.driverId ?? "", vehicleId: e.vehicleId ?? "", description: e.description ?? "",
                    }}
                  />
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
            pageSize={EXPENSE_PAGE_SIZE}
            hrefFor={(page) => withParams("/analytics/expenses", current, { page: page === 1 ? undefined : page })}
          />
        </div>
      </Card>
    </div>
  );
}
