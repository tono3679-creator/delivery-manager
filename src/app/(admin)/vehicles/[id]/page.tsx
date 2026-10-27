import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Factory, NotebookPen, ShieldCheck, Tag, UserRound, Weight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BackLink, DetailItem, Muted } from "@/components/common/detail";
import { EmptyState } from "@/components/common/empty-state";
import { VehicleStatusBadge } from "@/components/common/master-badges";
import { AssignVehicleButton } from "@/components/masters/assign-vehicle-dialog";
import { DeleteMasterButton } from "@/components/masters/delete-master-button";
import { VehicleFormButton } from "@/components/masters/vehicle-form";
import { asAdmin } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { DEADLINE_WARNING_DAYS, getDriverChoices, getVehicleDetail } from "@/lib/data/vehicles";
import { DRIVER_STATUS_LABEL, EXPENSE_CATEGORY_LABEL, type DriverStatus } from "@/lib/domain/labels";
import { formatDate, formatDaysLeft, formatNumber, formatYen } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "車両詳細" };

export default async function VehicleDetailPage({ params }: Props) {
  const { id } = await params;
  const today = todayJst();
  const { vehicle, drivers } = await asAdmin(async (tx) => {
    const [vehicle, drivers] = await Promise.all([getVehicleDetail(tx, id, today), getDriverChoices(tx)]);
    return { vehicle, drivers };
  });
  if (!vehicle) notFound();
  const retired = vehicle.status === "retired";

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <BackLink href="/vehicles" label="車両一覧" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{vehicle.plate}</h1>
              <VehicleStatusBadge status={vehicle.status} />
            </div>
            <p className="text-sm text-muted-foreground tabular">
              {vehicle.code}・{vehicle.type}
              {vehicle.activeOrders > 0 && `・対応中の案件 ${vehicle.activeOrders}件で使用`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <VehicleFormButton
              variant="edit"
              id={vehicle.id}
              code={vehicle.code}
              activeOrders={vehicle.activeOrders}
              initial={{
                plateNumber: vehicle.plate, vehicleType: vehicle.type, maker: vehicle.maker, model: vehicle.model ?? "",
                capacityKg: vehicle.capacityKg === null ? "" : String(vehicle.capacityKg),
                inspectionExpiresOn: vehicle.inspection, insuranceExpiresOn: vehicle.insurance, status: vehicle.status, notes: vehicle.notes ?? "",
              }}
            />
            <DeleteMasterButton kind="vehicle" id={vehicle.id} name={vehicle.plate} redirectTo="/vehicles" />
          </div>
        </div>
      </div>

      <section aria-label="期限" className="grid gap-3 sm:grid-cols-2">
        <DeadlineCard icon={CalendarClock} label="車検満了日" date={vehicle.inspection} days={vehicle.inspectionDays} retired={retired} />
        <DeadlineCard icon={ShieldCheck} label="任意保険の満了日" date={vehicle.insurance} days={vehicle.insuranceDays} retired={retired} />
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>担当の履歴</CardTitle>
              <span className="text-xs text-muted-foreground">新しい順・最大10件</span>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {vehicle.assignments.length === 0 ? (
                <EmptyState title="担当の記録はありません" className="py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">ドライバー</TableHead>
                      <TableHead>開始日</TableHead>
                      <TableHead className="pr-5">終了日</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vehicle.assignments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="pl-5"><Link href={`/drivers/${a.driverId}`} className="hover:underline">{a.driverName}</Link></TableCell>
                        <TableCell className="tabular">{formatDate(a.startOn)}</TableCell>
                        <TableCell className="pr-5 tabular">{a.endOn ? formatDate(a.endOn) : <Badge variant="info">担当中</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>この車両の経費</CardTitle>
              <span className="text-xs text-muted-foreground tabular">直近6か月の合計 {formatYen(vehicle.expenseTotal6m)}</span>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {vehicle.expenses.length === 0 ? (
                <EmptyState title="経費の記録はありません" description="燃料費や整備費を経費に登録するとき、車両を選ぶとここに表示されます。" className="py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">日付</TableHead>
                      <TableHead>カテゴリ</TableHead>
                      <TableHead className="hidden sm:table-cell">内容</TableHead>
                      <TableHead className="pr-5 text-right">金額</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vehicle.expenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="pl-5 tabular whitespace-nowrap">{formatDate(e.spentOn)}</TableCell>
                        <TableCell className="whitespace-nowrap">{EXPENSE_CATEGORY_LABEL[e.category]}</TableCell>
                        <TableCell className="hidden max-w-56 truncate sm:table-cell">{e.description ?? <Muted />}</TableCell>
                        <TableCell className="pr-5 text-right tabular">{formatYen(e.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="order-first min-w-0 space-y-5 lg:order-none">
          <Card>
            <CardHeader>
              <CardTitle>担当ドライバー</CardTitle>
              {!retired && (
                <AssignVehicleButton
                  mode="vehicle"
                  fixedId={vehicle.id}
                  currentId={vehicle.driverId}
                  label={vehicle.driverId ? "変更" : "割り当てる"}
                  options={drivers.map((d) => ({
                    id: d.id,
                    label: d.name,
                    takenBy: d.vehicle_id && d.vehicle_id !== vehicle.id ? `${d.plate_number}` : null,
                    note: d.status !== "active" && !d.vehicle_id ? DRIVER_STATUS_LABEL[d.status as DriverStatus] : null,
                  }))}
                />
              )}
            </CardHeader>
            <CardContent>
              {vehicle.driverId ? (
                <Link href={`/drivers/${vehicle.driverId}`} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-info-soft text-info-strong">
                    <UserRound className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{vehicle.driverName}</span>
                    {vehicle.assignments[0] && !vehicle.assignments[0].endOn && (
                      <span className="block text-xs text-muted-foreground">{formatDate(vehicle.assignments[0].startOn)}から担当</span>
                    )}
                  </span>
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">{retired ? "廃車のため担当はいません。" : "担当ドライバーはいません。"}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>車両情報</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-3.5 text-sm">
                <DetailItem icon={Tag} label="管理コード">{vehicle.code}</DetailItem>
                <DetailItem icon={Factory} label="メーカー・車名">{vehicle.maker}{vehicle.model && ` ${vehicle.model}`}</DetailItem>
                <DetailItem icon={Weight} label="最大積載量">{vehicle.capacityKg ? formatNumber(vehicle.capacityKg, "kg") : <Muted />}</DetailItem>
                <DetailItem icon={CalendarClock} label={`${Number(today.slice(5, 7))}月の使用`}>{formatNumber(vehicle.monthOrders, "件")}</DetailItem>
                {vehicle.notes && <DetailItem icon={NotebookPen} label="メモ"><span className="whitespace-pre-wrap">{vehicle.notes}</span></DetailItem>}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DeadlineCard({ icon: Icon, label, date, days, retired }: { icon: typeof CalendarClock; label: string; date: string; days: number; retired: boolean }) {
  const tone = retired ? "neutral" : days < 0 ? "danger" : days <= DEADLINE_WARNING_DAYS ? "warning" : "ok";
  return (
    <Card className={cn("flex items-center gap-3 p-4", tone === "danger" && "border-danger-strong/40 bg-danger-soft", tone === "warning" && "border-warning/50 bg-warning-soft")}>
      <span className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg",
        tone === "danger" ? "bg-card text-danger-strong" : tone === "warning" ? "bg-card text-warning-strong" : "bg-muted text-muted-foreground",
      )}>
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="tabular text-lg font-bold">{formatDate(date)}</div>
      </div>
      {!retired && (
        <span className={cn(
          "ml-auto shrink-0 text-sm font-semibold tabular",
          tone === "danger" ? "text-danger-strong" : tone === "warning" ? "text-warning-strong" : "text-muted-foreground",
        )}>
          {formatDaysLeft(days)}
        </span>
      )}
    </Card>
  );
}
