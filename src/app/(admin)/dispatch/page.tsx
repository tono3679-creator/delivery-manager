import { CalendarX2, MousePointerClick, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { DayNav } from "@/components/dispatch/day-nav";
import { DispatchBoard } from "@/components/dispatch/dispatch-board";
import { NewOrderButton } from "@/components/orders/new-order-button";
import { asAdmin } from "@/lib/auth";
import { getDispatchBoard } from "@/lib/data/dispatch";
import { getFormOptions } from "@/lib/data/orders";
import { addDays, daysBetween, isDateString, todayJst } from "@/lib/date";
import { overlappingIds } from "@/lib/domain/schedule";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "配車管理" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DispatchPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const today = todayJst();
  const requested = typeof sp.date === "string" && isDateString(sp.date) ? sp.date : today;
  // 極端な日付は扱わない（URL を書き換えての大量取得を防ぐ）
  const day = Math.abs(daysBetween(today, requested)) > 400 ? today : requested;

  const { board, options } = await asAdmin(async (tx) => {
    const [board, options] = await Promise.all([getDispatchBoard(tx, day), getFormOptions(tx)]);
    return { board, options };
  });

  const active = board.orders.filter((o) => o.status !== "cancelled");
  const unassigned = active.filter((o) => o.status === "unassigned").length;
  const assignedDrivers = new Set(active.map((o) => o.driverId).filter(Boolean)).size;
  let overlapCount = 0;
  for (const d of board.drivers) {
    const windows = active
      .filter((o) => o.driverId === d.id && ["assigned", "picked_up", "in_transit"].includes(o.status))
      .map((o) => ({ id: o.id, start: new Date(o.pickupAt), end: new Date(o.deliveryAt) }));
    overlapCount += overlappingIds(windows).size;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="配車管理"
        description="案件をドライバーの行へドラッグすると配車できます。横に動かすと時刻も変わります（15分単位）。"
        actions={<NewOrderButton options={options} defaultDay={day < today ? addDays(today, 1) : day} label="案件を登録" />}
      />

      <Card>
        <div className="flex flex-col gap-3 border-b px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <DayNav day={day} today={today} />
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Stat label="案件" value={`${formatNumber(active.length)}件`} />
            <Stat label="未割当" value={`${formatNumber(unassigned)}件`} tone={unassigned > 0 ? "warning" : undefined} />
            <Stat label="稼働ドライバー" value={`${formatNumber(assignedDrivers)}名`} />
            <Stat label="時間の重複" value={`${formatNumber(overlapCount)}件`} tone={overlapCount > 0 ? "danger" : undefined} />
          </dl>
        </div>

        {active.length === 0 ? (
          <EmptyState
            icon={CalendarX2}
            title="この日の配送案件はありません"
            description="「案件を登録」から追加するか、別の日を表示してください。"
          />
        ) : (
          <DispatchBoard day={day} today={today} nowIso={new Date().toISOString()} drivers={board.drivers} orders={active} />
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 text-xs text-muted-foreground sm:px-5">
          <Legend className="border-dashed border-warning-strong/60 bg-card" label="未割当" />
          <Legend className="border-brand/40 bg-info-soft" label="配車済（ドラッグ可）" />
          <Legend className="border-warning/60 bg-warning-soft" label="集荷完了・配送中" />
          <Legend className="border-success/40 bg-success-soft" label="配送完了" />
          <Legend className="border-destructive/40 bg-danger-soft" label="配送失敗" />
          <span className="flex items-center gap-1.5">
            <TriangleAlert className="size-3.5 text-danger-strong" aria-hidden />赤枠：同じドライバーの時間が重複（警告のみ・保存は可能）
          </span>
          <span className="flex items-center gap-1.5">
            <MousePointerClick className="size-3.5" aria-hidden />クリックで詳細と担当・時刻の変更（スマホは長押しでドラッグ）
          </span>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warning" | "danger" }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-semibold tabular", tone === "warning" && "text-warning-strong", tone === "danger" && "text-danger-strong")}>{value}</dd>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-5 rounded-sm border", className)} aria-hidden />
      {label}
    </span>
  );
}
