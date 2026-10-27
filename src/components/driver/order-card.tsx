import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import { LateBadge, StatusBadge } from "@/components/common/status-badge";
import type { DriverOrderCard } from "@/lib/data/driver";
import { formatDateShort, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** ドライバー用の案件カード（タップで詳細へ） */
export function DriverOrderCardLink({ order, showDate = false, className }: { order: DriverOrderCard; showDate?: boolean; className?: string }) {
  const done = order.status === "delivered" || order.status === "failed";
  return (
    <Link
      href={`/driver/orders/${order.id}`}
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:bg-accent/50 active:bg-accent",
        done && "bg-muted/40",
        className,
      )}
    >
      <div className="w-14 shrink-0 text-center tabular">
        {showDate && <div className="text-[11px] text-muted-foreground">{formatDateShort(order.deliveryAt)}</div>}
        <div className={cn("text-lg font-bold leading-tight", done && "text-muted-foreground")}>{formatTime(order.pickupAt)}</div>
        <div className="text-xs text-muted-foreground">〜{formatTime(order.deliveryAt)}</div>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={order.status} />
          {order.isLate && <LateBadge />}
        </div>
        <p className={cn("truncate font-semibold", done && "text-muted-foreground")}>{order.deliveryName}</p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{order.deliveryAddress}</span>
        </p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
