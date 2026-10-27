import Link from "next/link";
import { AlarmClock, ArrowRight, CircleCheckBig, Package, Percent, PiggyBank, Receipt, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { ProfitTrendChart } from "@/components/analytics/charts";
import { PeriodFilter } from "@/components/analytics/period-filter";
import { ShareBar } from "@/components/analytics/share-bar";
import { HorizontalBars } from "@/components/dashboard/charts";
import { KpiCard, Trend } from "@/components/dashboard/kpi-card";
import { asAdmin } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { getAnalytics, resolvePeriod } from "@/lib/data/analytics";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/domain/labels";
import { formatDate, formatNumber, formatPercent, formatYen, formatYenCompact } from "@/lib/format";

export const metadata = { title: "売上・分析" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** 増減率（前の期間が 0 なら比較しない） */
function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** 率の差（ポイント） */
function diff(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

const GRAIN_LABEL = { day: "日別", week: "週別", month: "月別" } as const;

/** 売上の多い順の順位（同額は同順位、売上 0 円は順位なし） */
function ranks(revenues: number[]): (number | null)[] {
  return revenues.map((r) => (r <= 0 ? null : 1 + revenues.filter((x) => x > r).length));
}

function Rank({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={value <= 3 ? "font-semibold text-foreground" : "text-muted-foreground"}>
      {value}<span className="sr-only">位</span>
    </span>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const today = todayJst();
  const period = resolvePeriod(params, today);
  const data = await asAdmin((tx) => getAnalytics(tx, period));
  const { summary: s, previous: p } = data;
  const query = new URLSearchParams(
    Object.entries({ period: params.period, from: params.from, to: params.to })
      .filter(([, v]) => typeof v === "string" && v)
      .map(([k, v]) => [k, v as string]),
  ).toString();

  const expenseTotal = data.breakdown.reduce((sum, b) => sum + b.amount, 0);
  const clientTotal = data.clients.reduce((sum, c) => sum + c.revenue, 0);
  const driverTotal = data.drivers.reduce((sum, d) => sum + d.revenue, 0);
  const clientRanks = ranks(data.clients.map((c) => c.revenue));
  const driverRanks = ranks(data.drivers.map((d) => d.revenue));
  const compare = `${p.label}（${formatDate(p.from)}〜${formatDate(p.to)}）`;
  // 比較期間の途中から記録が始まっている場合は増減を出さない
  const pct = (current: number, previous: number) => (p.complete ? change(current, previous) : null);
  const pt = (current: number | null, previous: number | null) => (p.complete ? diff(current, previous) : null);
  const prevAmount = (value: number) => (p.complete ? `${p.label} ${formatYenCompact(value)}` : undefined);

  return (
    <div className="space-y-5">
      <PageHeader
        title="売上・分析"
        description="売上は配送完了分の料金、粗利益は売上から経費を引いた金額です。ダッシュボード・ドライバー・荷主の画面と同じ集計を使っています。"
        actions={<AnalyticsNav current="sales" query={query} />}
      />

      <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <PeriodFilter preset={period.preset} from={period.from} to={period.to} today={today} />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular">{formatDate(period.from)}〜{formatDate(period.to)}</span>
          <span className="ml-2 text-xs">比較：{compare}</span>
          {!p.complete && (
            <span className="block text-xs text-warning-strong sm:text-right">
              {p.recordStart
                ? `記録の開始（${formatDate(p.recordStart)}）より前を含むため、増減は表示しません`
                : "比較できる記録がありません"}
            </span>
          )}
        </p>
      </Card>

      <section aria-label="期間の実績" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="売上" value={formatYen(s.revenue)} icon={TrendingUp} tone="brand" trend={pct(s.revenue, p.revenue)}
          sub={prevAmount(p.revenue)} />
        <KpiCard label="経費" value={formatYen(s.expense)} icon={Receipt} tone="warning" trend={pct(s.expense, p.expense)} trendGood="down"
          sub={prevAmount(p.expense)} />
        <KpiCard label="粗利益" value={formatYen(s.grossProfit)} icon={PiggyBank} tone={s.grossProfit < 0 ? "danger" : "success"}
          trend={pct(s.grossProfit, p.grossProfit)} sub={prevAmount(p.grossProfit)} />
        <KpiCard label="粗利益率" value={formatPercent(s.grossMargin)} icon={Percent} tone="success"
          sub={<><Trend value={pt(s.grossMargin, p.grossMargin)} unit="pt" /><span>粗利益 ÷ 売上</span></>} />
        <KpiCard label="配送件数" value={formatNumber(s.orderCount)} unit="件" icon={Package} trend={pct(s.orderCount, p.orderCount)}
          sub="キャンセルを除く" />
        <KpiCard label="配送完了" value={formatNumber(s.deliveredCount)} unit="件" icon={CircleCheckBig} tone="success"
          trend={pct(s.deliveredCount, p.deliveredCount)} sub={`完了率 ${formatPercent(s.orderCount === 0 ? null : (s.deliveredCount / s.orderCount) * 100)}`} />
        <KpiCard label="平均単価" value={formatYen(s.averageFee)} icon={Wallet}
          trend={s.averageFee === null || p.averageFee === null ? null : pct(s.averageFee, p.averageFee)} sub="配送完了1件あたり" />
        <KpiCard label="遅延率" value={formatPercent(s.lateRate)} icon={AlarmClock} tone={s.lateCount > 0 ? "danger" : "default"}
          sub={<><Trend value={pt(s.lateRate, p.lateRate)} unit="pt" good="down" /><span>遅延 {formatNumber(s.lateCount, "件")}</span></>} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>売上・経費・粗利益の推移（{GRAIN_LABEL[period.grain]}）</CardTitle>
          <span className="hidden text-xs text-muted-foreground sm:inline">期間の長さに合わせて日別・週別・月別を切り替えます</span>
        </CardHeader>
        <CardContent>
          <ProfitTrendChart data={data.series} grain={period.grain} />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>経費の内訳</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href={query ? `/analytics/expenses?${query}` : "/analytics/expenses"}>経費の一覧・登録 <ArrowRight aria-hidden /></Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.breakdown.length === 0 ? (
              <EmptyState title="この期間の経費はありません" className="py-8" />
            ) : (
              <>
                <HorizontalBars
                  unit="yen"
                  valueLabel="経費"
                  data={data.breakdown.map((b) => ({ name: EXPENSE_CATEGORY_LABEL[b.category], value: b.amount }))}
                />
                <ul className="grid gap-1.5 border-t pt-3 text-sm">
                  {data.breakdown.map((b) => (
                    <li key={b.category} className="flex items-center gap-2">
                      <span className="text-muted-foreground">{EXPENSE_CATEGORY_LABEL[b.category]}</span>
                      <span className="ml-auto tabular">{formatYen(b.amount)}</span>
                      <span className="w-14 text-right text-xs tabular text-muted-foreground">{formatPercent((b.amount / expenseTotal) * 100)}</span>
                    </li>
                  ))}
                  <li className="flex items-center gap-2 border-t pt-1.5 font-semibold">
                    合計<span className="ml-auto tabular">{formatYen(expenseTotal)}</span><span className="w-14" />
                  </li>
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>荷主別の売上ランキング</CardTitle>
            <span className="text-xs text-muted-foreground">合計 {formatYen(clientTotal)}</span>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 pl-5 text-right">順位</TableHead>
                  <TableHead>荷主</TableHead>
                  <TableHead className="text-right">件数</TableHead>
                  <TableHead className="text-right">売上</TableHead>
                  <TableHead className="pr-5 text-right">構成比</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.clients.map((c, i) => (
                  <TableRow key={c.clientId}>
                    <TableCell className="pl-5 text-right tabular"><Rank value={clientRanks[i]} /></TableCell>
                    <TableCell className="max-w-48 truncate">
                      <Link href={`/clients/${c.clientId}`} className="hover:underline">{c.name}</Link>
                    </TableCell>
                    <TableCell className="text-right tabular">{formatNumber(c.orders)}</TableCell>
                    <TableCell className="text-right tabular">{formatYen(c.revenue)}</TableCell>
                    <TableCell className="pr-5"><ShareBar value={clientTotal === 0 ? null : (c.revenue / clientTotal) * 100} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ドライバー別の売上ランキング</CardTitle>
          <span className="hidden text-xs text-muted-foreground sm:inline">売上の多い順・遅延は予定から15分超</span>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 pl-5 text-right">順位</TableHead>
                  <TableHead>ドライバー</TableHead>
                  <TableHead className="text-right">配送件数</TableHead>
                  <TableHead className="text-right">完了</TableHead>
                  <TableHead className="text-right">完了率</TableHead>
                  <TableHead className="text-right">遅延</TableHead>
                  <TableHead className="text-right">遅延率</TableHead>
                  <TableHead className="text-right">売上</TableHead>
                  <TableHead className="pr-5 text-right">構成比</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.drivers.map((d, i) => (
                  <TableRow key={d.driverId}>
                    <TableCell className="pl-5 text-right tabular"><Rank value={driverRanks[i]} /></TableCell>
                    <TableCell className="whitespace-nowrap"><Link href={`/drivers/${d.driverId}`} className="hover:underline">{d.name}</Link></TableCell>
                    <TableCell className="text-right tabular">{formatNumber(d.orders)}</TableCell>
                    <TableCell className="text-right tabular">{formatNumber(d.delivered)}</TableCell>
                    <TableCell className="text-right tabular">{formatPercent(d.completionRate)}</TableCell>
                    <TableCell className={`text-right tabular ${d.late > 0 ? "text-danger-strong" : ""}`}>{formatNumber(d.late)}</TableCell>
                    <TableCell className="text-right tabular">{formatPercent(d.orders === 0 ? null : (d.late / d.orders) * 100)}</TableCell>
                    <TableCell className="text-right tabular">{formatYen(d.revenue)}</TableCell>
                    <TableCell className="pr-5"><ShareBar value={driverTotal === 0 ? null : (d.revenue / driverTotal) * 100} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
