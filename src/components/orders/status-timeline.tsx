import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/domain/status";
import { formatDateTimeFull } from "@/lib/format";
import { cn } from "@/lib/utils";

const DOT: Record<OrderStatus, string> = {
  unassigned: "bg-warning",
  assigned: "bg-brand",
  picked_up: "bg-brand",
  in_transit: "bg-warning",
  delivered: "bg-success",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
};

/** ステータス履歴（新しい順） */
export function StatusTimeline({
  logs,
}: { logs: { id: string; from: OrderStatus | null; to: OrderStatus; by: string | null; note: string | null; at: Date }[] }) {
  const items = [...logs].reverse();
  return (
    <ol className="relative grid gap-4">
      {items.map((l, i) => (
        <li key={l.id} className="relative grid grid-cols-[1rem_1fr] gap-3">
          {i < items.length - 1 && <span className="absolute top-4 bottom-[-1rem] left-[7px] w-px bg-border" aria-hidden />}
          <span className={cn("relative mt-1 size-3.5 rounded-full ring-4 ring-card", DOT[l.to])} aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {l.from ? `${ORDER_STATUS_LABEL[l.from]} → ` : ""}{ORDER_STATUS_LABEL[l.to]}
            </p>
            <p className="text-xs text-muted-foreground tabular">
              {formatDateTimeFull(l.at)}・{l.by ?? "システム"}
            </p>
            {l.note && <p className="mt-1 rounded-md bg-muted px-2.5 py-1.5 text-sm">{l.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
