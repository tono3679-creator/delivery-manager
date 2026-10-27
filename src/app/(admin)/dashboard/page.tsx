import Link from "next/link";
import {
  CalendarCheck, CircleCheckBig, Truck, CircleDashed, Percent, Users, Wallet, TrendingUp, PiggyBank, ArrowUpDown, ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { LateBadge, StatusBadge } from "@/components/common/status-badge";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AlertsCard } from "@/components/dashboard/alerts-card";
import { HorizontalBars, SalesTrendChart, StatusDonut } from "@/components/dashboard/charts";
import { MapPanel } from "@/components/map/map-panel";
import { DayDoneNotice } from "@/components/dashboard/day-done-notice";
import { asAdmin } from "@/lib/auth";
import {
  getClientRanking, getDashboardAlerts, getDashboardKpis, getDashboardSeries, getDriverPerformance, getTodayOrders, getDayCounts,
} from "@/lib/data/dashboard";
import { getDriverPositions } from "@/lib/data/driver-positions";
import { getMapOrders } from "@/lib/data/map";
import { addDays, startOfMonth, todayJst } from "@/lib/date";
import { formatNumber, formatPercent, formatTime, formatYen, formatYenCompact } from "@/lib/format";

export const metadata = { title: "ダッシュボード" };

export default async function DashboardPage() {
  const today = todayJst();
  const monthStart = startOfMonth(today);
  const tomorrow = addDays(today, 1);
  const { kpis, series, drivers, clients, orders, alerts, mapOrders, next, driverPositions } = await asAdmin(async (tx) => {
    const [kpis, series, drivers, clients, orders, alerts, mapOrders, next, driverPositions] = await Promise.all([
      getDashboardKpis(tx, today),
      getDashboardSeries(tx, today),
      getDriverPerformance(tx, monthStart, today),
      getClientRanking(tx, monthStart, today),
      getTodayOrders(tx, today, 8),
      getDashboardAlerts(tx, today),
      getMapOrders(tx, today),
      getDayCounts(tx, tomorrow),
      getDriverPositions(tx),
    ]);
    return { kpis, series, drivers, clients, orders, alerts, mapOrders, next, driverPositions };
  });
  const dayDone = kpis.planned > 0 && kpis.inProgress === 0 && kpis.notStarted === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="ダッシュボード"
        description="本日の配送状況と今月の売上を、すべて実データから集計して表示しています。"
        actions={
          <>
            <Button asChild variant="outline"><Link href="/orders">配送案件</Link></Button>
            <Button asChild><Link href={`/dispatch?date=${today}`}>配車ボードを開く</Link></Button>
          </>
        }
      />
      <section aria-label="主要指標" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="本日の配送予定" value={formatNumber(kpis.planned)} unit="件" icon={CalendarCheck} tone="brand"
          sub={kpis.unassigned > 0 ? <span className="text-warning-strong">うち未割当 {kpis.unassigned}件</span> : "すべて配車済み"} />
        <KpiCard label="配送完了" value={formatNumber(kpis.delivered)} unit="件" icon={CircleCheckBig} tone="success"
          sub={[kpis.failed > 0 && `配送失敗 ${kpis.failed}件`, kpis.lateDelivered > 0 && `遅れて完了 ${kpis.lateDelivered}件`].filter(Boolean).join("・") || "遅延なく完了"} />
        <KpiCard label="配送中" value={formatNumber(kpis.inProgress)} unit="件" icon={Truck} tone="warning"
          sub={kpis.late > 0 ? <span className="font-medium text-danger-strong">予定超過 {kpis.late}件</span> : "予定超過なし"} />
        <KpiCard label="未着手" value={formatNumber(kpis.notStarted)} unit="件" icon={CircleDashed} />
        <KpiCard label="配送完了率" value={formatPercent(kpis.completionRate)} icon={Percent} tone="success"
          sub="本日の予定に対する完了の割合" />
        <KpiCard label="稼働ドライバー" value={formatNumber(kpis.activeDrivers)} unit="名" icon={Users} tone="brand"
          sub="本日の担当がいるドライバー" />
        <KpiCard label="本日の売上見込み" value={formatYen(kpis.expectedRevenueToday)} icon={Wallet}
          sub="キャンセル・失敗を除く本日分" />
        <KpiCard label="今月の売上" value={formatYen(kpis.monthRevenue)} icon={TrendingUp} tone="brand"
          sub={`${Number(monthStart.slice(5, 7))}月1日〜本日・配送完了分`} />
        <KpiCard label="今月の粗利益" value={formatYen(kpis.monthGrossProfit)} icon={PiggyBank} tone="success"
          sub={`粗利益率 ${formatPercent(kpis.monthGrossMargin)}`} />
        <KpiCard label="前月比 売上" value={kpis.revenueMoM === null ? "—" : `${kpis.revenueMoM > 0 ? "+" : ""}${kpis.revenueMoM.toFixed(1)}`}
          unit={kpis.revenueMoM === null ? undefined : "%"} icon={ArrowUpDown}
          tone={kpis.revenueMoM === null ? "default" : kpis.revenueMoM >= 0 ? "success" : "danger"}
          sub={`前月同期 ${formatYenCompact(kpis.prevMonthRevenueSamePeriod)}`} />
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>本日の配送マップ</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dispatch?view=map">配車管理で開く <ArrowRight aria-hidden /></Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {dayDone && (
              <DayDoneNotice delivered={kpis.delivered} failed={kpis.failed} nextDay={tomorrow} nextCount={next.total} nextUnassigned={next.unassigned} view="map" />
            )}
            <MapPanel
              orders={mapOrders}
              fitKey={today}
              mapClassName="h-72 sm:h-80"
              label="本日の配送先とドライバーの現在地の地図"
              drivers={driverPositions}
              liveDrivers
            />
          </CardContent>
        </Card>
        <AlertsCard alerts={alerts} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>本日の配送状況</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/orders?from=${today}&to=${today}`}>
                すべて見る <ArrowRight aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {orders.length === 0 ? (
              <EmptyState title="本日の配送予定はありません" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">案件ID</TableHead>
                    <TableHead>荷主</TableHead>
                    <TableHead>担当</TableHead>
                    <TableHead>配送先</TableHead>
                    <TableHead>配送予定</TableHead>
                    <TableHead className="pr-5">ステータス</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id} className="relative">
                      <TableCell className="pl-5 font-medium tabular whitespace-nowrap">
                        <Link href={`/orders/${o.id}`} className="after:absolute after:inset-0 hover:underline">{o.orderNo}</Link>
                      </TableCell>
                      <TableCell className="max-w-40 truncate">{o.clientName}</TableCell>
                      <TableCell className="whitespace-nowrap">{o.driverName ?? <span className="text-warning-strong">未割当</span>}</TableCell>
                      <TableCell className="max-w-56 truncate">{o.deliveryName}</TableCell>
                      <TableCell className="tabular">{formatTime(o.deliveryAt)}</TableCell>
                      <TableCell className="pr-5">
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge status={o.status} />
                          {o.isLate && <LateBadge />}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>本日のステータス内訳</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusDonut counts={{ notStarted: kpis.notStarted, inProgress: kpis.inProgress, delivered: kpis.delivered, failed: kpis.failed }} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>売上推移</CardTitle>
        </CardHeader>
        <CardContent>
          <SalesTrendChart data={series} />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>ドライバー別 配送実績（今月）</CardTitle>
            <span className="text-xs text-muted-foreground">配送完了件数</span>
          </CardHeader>
          <CardContent>
            <HorizontalBars
              data={drivers.filter((d) => d.delivered > 0).sort((a, b) => b.delivered - a.delivered).slice(0, 10)
                .map((d) => ({ name: d.name, value: d.delivered }))}
              valueLabel="配送完了"
              unit="count"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>荷主別 売上 上位5社（今月）</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/analytics">分析を見る <ArrowRight aria-hidden /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            <HorizontalBars
              data={clients.slice(0, 5).map((c) => ({ name: c.name.replace(/株式会社/g, ""), value: c.revenue }))}
              valueLabel="売上"
              unit="yen"
              height={190}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
