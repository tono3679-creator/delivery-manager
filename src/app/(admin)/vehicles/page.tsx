import Link from "next/link";
import { Truck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { ListFilters } from "@/components/common/list-filters";
import { DeadlineBadge, VehicleStatusBadge } from "@/components/common/master-badges";
import { PageHeader } from "@/components/common/page-header";
import { Muted } from "@/components/common/detail";
import { VehicleFormButton } from "@/components/masters/vehicle-form";
import { asAdmin } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { DEADLINE_WARNING_DAYS, listVehicles, parseVehicleFilters, type VehicleRow } from "@/lib/data/vehicles";
import { VEHICLE_STATUSES, VEHICLE_STATUS_LABEL } from "@/lib/domain/labels";
import { formatDate, formatNumber } from "@/lib/format";
import { emptyVehicleForm } from "@/lib/validation/master";

export const metadata = { title: "車両管理" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const isDue = (v: VehicleRow) => v.status !== "retired" && Math.min(v.inspectionDays, v.insuranceDays) <= DEADLINE_WARNING_DAYS;

export default async function VehiclesPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseVehicleFilters(await searchParams);
  const today = todayJst();
  const vehicles = await asAdmin((tx) => listVehicles(tx, filters, today));
  const due = vehicles.filter(isDue).length;
  const month = Number(today.slice(5, 7));

  return (
    <div className="space-y-5">
      <PageHeader
        title="車両管理"
        description={`担当ドライバーと車検・保険の期限を管理します。期限まで${DEADLINE_WARNING_DAYS}日以内の車両には印が付きます。`}
        actions={<VehicleFormButton initial={emptyVehicleForm(today)} />}
      />
      <Card>
        <ListFilters
          placeholder="車両番号・コード・車種・担当者で検索"
          selects={[
            { key: "status", label: "ステータス", allLabel: "すべてのステータス", options: VEHICLE_STATUSES.map((s) => ({ value: s, label: VEHICLE_STATUS_LABEL[s] })) },
          ]}
          toggles={[{ key: "due", label: "期限が近い車両のみ" }]}
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b bg-muted/40 px-4 py-2.5 text-sm sm:px-5">
          <span>該当 <strong className="tabular">{vehicles.length}</strong> 台</span>
          <span className="text-muted-foreground">
            うち期限が近い・過ぎている <strong className={due > 0 ? "text-warning-strong tabular" : "text-foreground tabular"}>{due}</strong> 台
          </span>
        </div>

        {vehicles.length === 0 ? (
          <EmptyState icon={Truck} title="条件に合う車両はありません" description="検索条件を変えるか、「条件をクリア」で絞り込みを解除してください。" />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">車両番号</TableHead>
                    <TableHead>車種</TableHead>
                    <TableHead>担当ドライバー</TableHead>
                    <TableHead>ステータス</TableHead>
                    <TableHead>車検満了</TableHead>
                    <TableHead>保険満了</TableHead>
                    <TableHead className="pr-5 text-right">{month}月の使用</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicles.map((v) => (
                    <TableRow key={v.id} className={v.status === "retired" ? "text-muted-foreground" : undefined}>
                      <TableCell className="pl-5">
                        <Link href={`/vehicles/${v.id}`} className="font-medium whitespace-nowrap text-brand hover:underline">{v.plate}</Link>
                        <div className="text-xs text-muted-foreground tabular">{v.code}</div>
                      </TableCell>
                      <TableCell>
                        <div className="whitespace-nowrap">{v.type}</div>
                        <div className="text-xs text-muted-foreground">{v.maker}{v.model && ` ${v.model}`}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {v.driverId ? <Link href={`/drivers/${v.driverId}`} className="hover:underline">{v.driverName}</Link> : <Muted>なし</Muted>}
                      </TableCell>
                      <TableCell><VehicleStatusBadge status={v.status} /></TableCell>
                      <TableCell>
                        <div className="tabular whitespace-nowrap">{formatDate(v.inspection)}</div>
                        {v.status !== "retired" && <DeadlineBadge days={v.inspectionDays} />}
                      </TableCell>
                      <TableCell>
                        <div className="tabular whitespace-nowrap">{formatDate(v.insurance)}</div>
                        {v.status !== "retired" && <DeadlineBadge days={v.insuranceDays} />}
                      </TableCell>
                      <TableCell className="pr-5 text-right tabular">{formatNumber(v.monthOrders, "件")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y md:hidden">
              {vehicles.map((v) => (
                <li key={v.id}>
                  <Link href={`/vehicles/${v.id}`} className="block space-y-1.5 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{v.plate}</span>
                      <VehicleStatusBadge status={v.status} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{v.code}・{v.type}・{v.driverName ?? "担当なし"}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="tabular">車検 {formatDate(v.inspection)}</span>
                      {v.status !== "retired" && <DeadlineBadge days={v.inspectionDays} />}
                      <span className="tabular">保険 {formatDate(v.insurance)}</span>
                      {v.status !== "retired" && <DeadlineBadge days={v.insuranceDays} />}
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
