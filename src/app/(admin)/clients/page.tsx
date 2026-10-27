import Link from "next/link";
import { Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Muted } from "@/components/common/detail";
import { EmptyState } from "@/components/common/empty-state";
import { ListFilters } from "@/components/common/list-filters";
import { PageHeader } from "@/components/common/page-header";
import { ShareBar } from "@/components/analytics/share-bar";
import { ClientFormButton } from "@/components/masters/client-form";
import { asAdmin } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { listClients, parseClientFilters } from "@/lib/data/clients";
import { formatDate, formatNumber, formatYen } from "@/lib/format";
import { EMPTY_CLIENT_FORM } from "@/lib/validation/master";

export const metadata = { title: "荷主管理" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseClientFilters(await searchParams);
  const today = todayJst();
  const clients = await asAdmin((tx) => listClients(tx, filters, today));
  const month = Number(today.slice(5, 7));
  const prevMonth = month === 1 ? 12 : month - 1;
  const total = clients.reduce((s, c) => s + c.monthRevenue, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="荷主管理"
        description={`取引先の連絡先と売上を確認できます。売上は配送完了分で、売上分析と同じ集計です（${month}月は1日〜本日）。`}
        actions={<ClientFormButton initial={EMPTY_CLIENT_FORM} />}
      />
      <Card>
        <ListFilters placeholder="会社名・コード・担当者・電話番号で検索" />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b bg-muted/40 px-4 py-2.5 text-sm sm:px-5">
          <span>該当 <strong className="tabular">{clients.length}</strong> 社</span>
          <span className="text-muted-foreground">{month}月の売上合計 <strong className="text-foreground tabular">{formatYen(total)}</strong></span>
        </div>

        {clients.length === 0 ? (
          <EmptyState icon={Building2} title="条件に合う荷主はありません" description="検索条件を変えるか、「条件をクリア」で絞り込みを解除してください。" />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">会社名</TableHead>
                    <TableHead>担当者・電話</TableHead>
                    <TableHead>取引開始</TableHead>
                    <TableHead className="text-right">{month}月の件数</TableHead>
                    <TableHead className="text-right">{month}月の売上</TableHead>
                    <TableHead className="text-right">{prevMonth}月の売上</TableHead>
                    <TableHead className="pr-5 text-right">構成比</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="pl-5">
                        <Link href={`/clients/${c.id}`} className="font-medium text-brand hover:underline">{c.name}</Link>
                        <div className="text-xs text-muted-foreground tabular">{c.code}</div>
                      </TableCell>
                      <TableCell>
                        <div>{c.contactName ?? <Muted />}</div>
                        {c.phone && <div className="text-xs text-muted-foreground tabular">{c.phone}</div>}
                      </TableCell>
                      <TableCell className="tabular whitespace-nowrap">{c.startedOn ? formatDate(c.startedOn) : <Muted />}</TableCell>
                      <TableCell className="text-right tabular">{formatNumber(c.monthOrders, "件")}</TableCell>
                      <TableCell className="text-right tabular font-medium">{formatYen(c.monthRevenue)}</TableCell>
                      <TableCell className="text-right tabular text-muted-foreground">{formatYen(c.prevMonthRevenue)}</TableCell>
                      <TableCell className="pr-5">
                        <ShareBar value={total === 0 ? null : (c.monthRevenue / total) * 100} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {clients.map((c) => (
                <li key={c.id}>
                  <Link href={`/clients/${c.id}`} className="block space-y-1 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{c.name}</span>
                      <span className="shrink-0 text-sm font-medium tabular">{formatYen(c.monthRevenue)}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{c.code}・{c.contactName ?? "担当者未登録"}</p>
                    <p className="text-xs text-muted-foreground">
                      {month}月 {formatNumber(c.monthOrders, "件")}・{prevMonth}月 {formatYen(c.prevMonthRevenue)}
                    </p>
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
