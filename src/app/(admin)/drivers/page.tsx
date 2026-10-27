import Link from "next/link";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { ListFilters } from "@/components/common/list-filters";
import { DriverStatusBadge } from "@/components/common/master-badges";
import { PageHeader } from "@/components/common/page-header";
import { Muted } from "@/components/common/detail";
import { DriverFormButton } from "@/components/masters/driver-form";
import { emptyDriverForm } from "@/lib/validation/master";
import { asAdmin } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { getOffices, listDrivers, parseDriverFilters } from "@/lib/data/drivers";
import { DRIVER_STATUSES, DRIVER_STATUS_LABEL, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL } from "@/lib/domain/labels";
import { formatNumber, formatPercent, formatYen } from "@/lib/format";

export const metadata = { title: "ドライバー管理" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DriversPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseDriverFilters(await searchParams);
  const today = todayJst();
  const { drivers, offices } = await asAdmin(async (tx) => {
    const [drivers, offices] = await Promise.all([listDrivers(tx, filters, today), getOffices(tx)]);
    return { drivers, offices };
  });
  const working = drivers.filter((d) => d.status === "active").length;
  const month = Number(today.slice(5, 7));

  return (
    <div className="space-y-5">
      <PageHeader
        title="ドライバー管理"
        description={`在籍状況・担当車両・${month}月の配送実績を確認できます。実績は売上分析と同じ集計です。`}
        actions={<DriverFormButton initial={emptyDriverForm(today)} offices={offices} />}
      />
      <Card>
        <ListFilters
          placeholder="氏名・フリガナ・コード・電話番号で検索"
          selects={[
            { key: "status", label: "ステータス", allLabel: "すべてのステータス", options: DRIVER_STATUSES.map((s) => ({ value: s, label: DRIVER_STATUS_LABEL[s] })) },
            { key: "employment", label: "雇用形態", allLabel: "すべての雇用形態", options: EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_TYPE_LABEL[t] })) },
          ]}
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b bg-muted/40 px-4 py-2.5 text-sm sm:px-5">
          <span>該当 <strong className="tabular">{drivers.length}</strong> 名</span>
          <span className="text-muted-foreground">うち稼働中 <strong className="text-foreground tabular">{working}</strong> 名</span>
        </div>

        {drivers.length === 0 ? (
          <EmptyState icon={Users} title="条件に合うドライバーはいません" description="検索条件を変えるか、「条件をクリア」で絞り込みを解除してください。" />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">氏名</TableHead>
                    <TableHead>雇用形態</TableHead>
                    <TableHead>営業所</TableHead>
                    <TableHead>担当車両</TableHead>
                    <TableHead>ステータス</TableHead>
                    <TableHead className="text-right">{month}月の完了</TableHead>
                    <TableHead className="text-right">完了率</TableHead>
                    <TableHead className="text-right">遅延</TableHead>
                    <TableHead className="pr-5 text-right">{month}月の売上</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drivers.map((d) => (
                    <TableRow key={d.id} className={d.status === "retired" ? "text-muted-foreground" : undefined}>
                      <TableCell className="pl-5">
                        <Link href={`/drivers/${d.id}`} className="font-medium text-brand hover:underline">{d.name}</Link>
                        <div className="text-xs text-muted-foreground tabular">{d.code}{d.nameKana && `・${d.nameKana}`}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{EMPLOYMENT_TYPE_LABEL[d.employmentType]}</TableCell>
                      <TableCell className="max-w-36 truncate">{d.officeName ?? <Muted />}</TableCell>
                      <TableCell className="whitespace-nowrap">{d.vehiclePlate ?? <Muted>なし</Muted>}</TableCell>
                      <TableCell><DriverStatusBadge status={d.status} /></TableCell>
                      <TableCell className="text-right tabular">
                        {formatNumber(d.monthDelivered)}<span className="text-xs text-muted-foreground"> / {formatNumber(d.monthOrders)}件</span>
                      </TableCell>
                      <TableCell className="text-right tabular">{formatPercent(d.completionRate)}</TableCell>
                      <TableCell className={`text-right tabular ${d.monthLate > 0 ? "text-danger-strong" : ""}`}>{formatNumber(d.monthLate, "件")}</TableCell>
                      <TableCell className="pr-5 text-right tabular">{formatYen(d.monthRevenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {drivers.map((d) => (
                <li key={d.id}>
                  <Link href={`/drivers/${d.id}`} className="block space-y-1.5 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{d.name}</span>
                      <DriverStatusBadge status={d.status} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {d.code}・{EMPLOYMENT_TYPE_LABEL[d.employmentType]}・{d.vehiclePlate ?? "担当車両なし"}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{month}月 完了 <strong className="text-foreground tabular">{d.monthDelivered}</strong>/{d.monthOrders}件</span>
                      <span>遅延 <strong className={`tabular ${d.monthLate > 0 ? "text-danger-strong" : "text-foreground"}`}>{d.monthLate}</strong>件</span>
                      <span>売上 <strong className="text-foreground tabular">{formatYen(d.monthRevenue)}</strong></span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
