import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, Building2, CalendarDays, KeyRound, Mail, NotebookPen, Phone, Truck, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BackLink, DetailItem, MiniStat, Muted } from "@/components/common/detail";
import { DriverStatusBadge } from "@/components/common/master-badges";
import { MonthlyRevenueChart } from "@/components/analytics/charts";
import { AssignVehicleButton } from "@/components/masters/assign-vehicle-dialog";
import { DeleteMasterButton } from "@/components/masters/delete-master-button";
import { DriverFormButton } from "@/components/masters/driver-form";
import { RecentOrders } from "@/components/masters/recent-orders";
import { asAdmin } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { getDriverDetail, getOffices, getVehicleChoices } from "@/lib/data/drivers";
import { EMPLOYMENT_TYPE_LABEL, VEHICLE_STATUS_LABEL, type VehicleStatus } from "@/lib/domain/labels";
import { formatDate, formatNumber, formatPercent, formatYen } from "@/lib/format";
import { telUrl } from "@/lib/maps";

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "ドライバー詳細" };

export default async function DriverDetailPage({ params }: Props) {
  const { id } = await params;
  const today = todayJst();
  const { driver, offices, vehicles } = await asAdmin(async (tx) => {
    const [driver, offices, vehicles] = await Promise.all([getDriverDetail(tx, id, today), getOffices(tx), getVehicleChoices(tx)]);
    return { driver, offices, vehicles };
  });
  if (!driver) notFound();
  const month = Number(today.slice(5, 7));
  const sixMonthRevenue = driver.series.reduce((s, p) => s + p.revenue, 0);
  const retired = driver.status === "retired";

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <BackLink href="/drivers" label="ドライバー一覧" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{driver.name}</h1>
              <DriverStatusBadge status={driver.status} />
            </div>
            <p className="text-sm text-muted-foreground tabular">
              {driver.code}・{EMPLOYMENT_TYPE_LABEL[driver.employmentType]}
              {driver.activeOrders > 0 && `・対応中の案件 ${driver.activeOrders}件`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href={`/orders?driver=${driver.id}`}>担当案件を見る</Link></Button>
            <DriverFormButton
              variant="edit"
              id={driver.id}
              code={driver.code}
              offices={offices}
              activeOrders={driver.activeOrders}
              initial={{
                name: driver.name, nameKana: driver.nameKana ?? "", phone: driver.phone ?? "", email: driver.email ?? "",
                officeId: driver.officeId ?? "", employmentType: driver.employmentType, status: driver.status, hiredOn: driver.hiredOn,
                notes: driver.notes ?? "",
              }}
            />
            <DeleteMasterButton kind="driver" id={driver.id} name={`${driver.name}さん`} redirectTo="/drivers" />
          </div>
        </div>
      </div>

      <section aria-label={`${month}月の実績`} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat label={`${month}月の配送件数`} value={formatNumber(driver.month.orders, "件")} sub="キャンセルを除く" />
        <MiniStat label="配送完了" value={formatNumber(driver.month.delivered, "件")} />
        <MiniStat label="完了率" value={formatPercent(driver.month.completionRate)} sub="完了 ÷ 配送件数" />
        <MiniStat label="遅延" value={formatNumber(driver.month.late, "件")} tone={driver.month.late > 0 ? "danger" : undefined} sub="予定から15分超" />
        <MiniStat label={`${month}月の売上`} value={formatYen(driver.month.revenue)} sub="配送完了分" className="col-span-2 sm:col-span-1" />
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>月別の売上（直近6か月）</CardTitle>
              <span className="text-xs text-muted-foreground tabular">合計 {formatYen(sixMonthRevenue)}</span>
            </CardHeader>
            <CardContent>
              <MonthlyRevenueChart data={driver.series} label={`${driver.name}さんの月別売上の棒グラフ`} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>最近の担当案件</CardTitle>
              <Button asChild variant="ghost" size="sm"><Link href={`/orders?driver=${driver.id}`}>すべて見る</Link></Button>
            </CardHeader>
            <div className="pb-2">
              <RecentOrders
                empty="まだ担当した案件はありません"
                rows={driver.recent.map((o) => ({ ...o, sub: o.clientName }))}
              />
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>担当車両</CardTitle>
              {!retired && (
                <AssignVehicleButton
                  mode="driver"
                  fixedId={driver.id}
                  currentId={driver.vehicle?.id ?? null}
                  label={driver.vehicle ? "変更" : "割り当てる"}
                  options={vehicles.map((v) => ({
                    id: v.id,
                    label: `${v.plate_number}（${v.vehicle_type}）`,
                    takenBy: v.driver_id && v.driver_id !== driver.id ? `${v.driver_name}さん` : null,
                    note: v.status !== "active" ? VEHICLE_STATUS_LABEL[v.status as VehicleStatus] : null,
                  }))}
                />
              )}
            </CardHeader>
            <CardContent>
              {driver.vehicle ? (
                <Link href={`/vehicles/${driver.vehicle.id}`} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-info-soft text-info-strong">
                    <Truck className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{driver.vehicle.plate}</span>
                    <span className="block text-xs text-muted-foreground">{driver.vehicle.type}・{formatDate(driver.vehicle.since)}から担当</span>
                  </span>
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">担当車両はありません。配車のとき車両は「指定なし」になります。</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>基本情報</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-3.5 text-sm">
                <DetailItem icon={Type} label="フリガナ">{driver.nameKana ?? <Muted />}</DetailItem>
                <DetailItem icon={Phone} label="電話番号">
                  {driver.phone ? <a href={telUrl(driver.phone)} className="text-brand hover:underline tabular">{driver.phone}</a> : <Muted />}
                </DetailItem>
                <DetailItem icon={Mail} label="メールアドレス">{driver.email ?? <Muted />}</DetailItem>
                <DetailItem icon={Building2} label="営業所">{driver.officeName ?? <Muted />}</DetailItem>
                <DetailItem icon={Briefcase} label="雇用形態">{EMPLOYMENT_TYPE_LABEL[driver.employmentType]}</DetailItem>
                <DetailItem icon={CalendarDays} label="入社日・契約開始日">{formatDate(driver.hiredOn)}</DetailItem>
                <DetailItem icon={KeyRound} label="ドライバー画面のログイン">{driver.hasLogin ? "アカウントあり" : <Muted>未発行</Muted>}</DetailItem>
                {driver.notes && <DetailItem icon={NotebookPen} label="メモ"><span className="whitespace-pre-wrap">{driver.notes}</span></DetailItem>}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
