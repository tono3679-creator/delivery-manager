"use client";
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/domain/status";

const ALL = "__all";
const STATUSES: OrderStatus[] = ["delivered", "failed", "cancelled", "assigned", "picked_up", "in_transit"];

export function HistoryFilters({ from, to, status, today }: { from: string; to: string; status?: OrderStatus; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (!v || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  return (
    <div className="grid gap-2 rounded-xl border bg-card p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <Input type="date" aria-label="期間（から）" value={from} max={today} onChange={(e) => update({ from: e.target.value })} />
        <span className="text-muted-foreground">〜</span>
        <Input type="date" aria-label="期間（まで）" value={to} max={today} onChange={(e) => update({ to: e.target.value })} />
      </div>
      <div className="flex items-center gap-2">
        <Select value={status ?? ALL} onValueChange={(v) => update({ status: v })}>
          <SelectTrigger className="h-11 flex-1" aria-label="ステータスで絞り込み"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>すべてのステータス</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{ORDER_STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        {pending && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="読み込み中" />}
      </div>
    </div>
  );
}
