import Link from "next/link";
import { EmptyState } from "@/components/common/empty-state";
import { LateBadge, StatusBadge } from "@/components/common/status-badge";
import type { OrderStatus } from "@/lib/domain/status";
import { formatTime, formatYen } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TodayOrderRow = {
  id: string; orderNo: string; deliveryName: string; clientName: string;
  pickupAt: Date; deliveryAt: Date; status: OrderStatus; isLate: boolean; fee: number;
};

/** ドライバー詳細の「本日の担当案件」。集荷予定の早い順に、時間帯とステータスを並べる */
export function TodayOrders({ rows, empty }: { rows: TodayOrderRow[]; empty: string }) {
  if (rows.length === 0) return <EmptyState title={empty} className="py-8" />;
  return (
    <ol className="divide-y">
      {rows.map((o) => (
        <li key={o.id}>
          <Link
            href={`/orders/${o.id}`}
            className={cn("flex items-start gap-3 px-5 py-3 hover:bg-accent/50", o.status === "cancelled" && "opacity-60")}
          >
            <div className="w-24 shrink-0 text-sm leading-tight tabular">
              <div className="font-medium">{formatTime(o.pickupAt)}〜{formatTime(o.deliveryAt)}</div>
              <div className="text-xs text-muted-foreground">集荷〜配送</div>
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-sm font-medium whitespace-nowrap text-brand tabular">{o.orderNo}</span>
                <span className="truncate text-sm">{o.deliveryName}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <StatusBadge status={o.status} />
                {o.isLate && <LateBadge />}
                <span className="truncate">{o.clientName}</span>
              </div>
            </div>
            <span className="hidden shrink-0 text-sm tabular sm:block">{formatYen(o.fee)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
