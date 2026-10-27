import Link from "next/link";
import { LateBadge, StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import type { OrderStatus } from "@/lib/domain/status";
import { formatDateShort, formatTime, formatYen } from "@/lib/format";

type Row = { id: string; orderNo: string; deliveryName: string; sub: string | null; deliveryAt: Date; status: OrderStatus; isLate: boolean; fee: number };

/** ドライバー詳細・荷主詳細の「最近の案件」 */
export function RecentOrders({ rows, empty }: { rows: Row[]; empty: string }) {
  if (rows.length === 0) return <EmptyState title={empty} className="py-8" />;
  return (
    <ul className="divide-y">
      {rows.map((o) => (
        <li key={o.id}>
          <Link href={`/orders/${o.id}`} className="flex items-start gap-3 px-5 py-3 hover:bg-accent/50">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-sm font-medium whitespace-nowrap text-brand tabular">{o.orderNo}</span>
                <span className="truncate text-sm">{o.deliveryName}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <StatusBadge status={o.status} />
                {o.isLate && <LateBadge />}
                <span className="tabular">{formatDateShort(o.deliveryAt)} {formatTime(o.deliveryAt)}</span>
                {o.sub && <span className="truncate">・{o.sub}</span>}
              </div>
            </div>
            <span className="shrink-0 text-sm tabular">{formatYen(o.fee)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
