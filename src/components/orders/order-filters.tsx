"use client";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ORDER_STATUSES, ORDER_STATUS_LABEL } from "@/lib/domain/status";
import { addDays, endOfMonth, startOfMonth } from "@/lib/date";
import { cn } from "@/lib/utils";

const ALL = "__all";

/** 検索・絞り込み。条件は URL に保存する（再読み込み・共有しても同じ結果になる） */
export function OrderFilters({
  clients, drivers, today,
}: { clients: { id: string; name: string }[]; drivers: { id: string; name: string }[]; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "" || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // キーワードは入力が止まってから検索する
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => update({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const ranges = [
    { label: "今日", from: today, to: today },
    { label: "明日", from: addDays(today, 1), to: addDays(today, 1) },
    { label: "過去7日", from: addDays(today, -6), to: today },
    { label: "今月", from: startOfMonth(today), to: endOfMonth(today) },
  ];
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const hasFilter = ["q", "from", "to", "client", "driver", "status", "late", "scope"].some((k) => params.get(k));

  return (
    <div className="flex flex-col gap-3 border-b px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="案件ID・配送先名・住所で検索"
            className="pl-9"
            aria-label="キーワード検索"
          />
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="配送予定日（から）" value={from} onChange={(e) => update({ from: e.target.value })} className="w-full lg:w-40" />
          <span className="text-muted-foreground">〜</span>
          <Input type="date" aria-label="配送予定日（まで）" value={to} onChange={(e) => update({ to: e.target.value })} className="w-full lg:w-40" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="配送予定日のかんたん指定">
        {ranges.map((r) => {
          const active = from === r.from && to === r.to;
          return (
            <button
              key={r.label}
              type="button"
              aria-pressed={active}
              onClick={() => update(active ? { from: null, to: null } : { from: r.from, to: r.to })}
              className={cn(
                "h-7 rounded-full border px-3 text-xs font-medium transition-colors",
                active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select value={params.get("client") ?? ALL} onValueChange={(v) => update({ client: v })}>
          <SelectTrigger className="sm:w-52" aria-label="荷主で絞り込み"><SelectValue placeholder="荷主" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>すべての荷主</SelectItem>
            {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={params.get("driver") ?? ALL} onValueChange={(v) => update({ driver: v })}>
          <SelectTrigger className="sm:w-44" aria-label="ドライバーで絞り込み"><SelectValue placeholder="ドライバー" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>すべてのドライバー</SelectItem>
            <SelectItem value="none">未割当のみ</SelectItem>
            {drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={params.get("status") ?? ALL} onValueChange={(v) => update({ status: v })}>
          <SelectTrigger className="sm:w-40" aria-label="ステータスで絞り込み"><SelectValue placeholder="ステータス" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>すべてのステータス</SelectItem>
            {ORDER_STATUSES.map((s) => <SelectItem key={s} value={s}>{ORDER_STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--destructive)]"
            checked={params.get("late") === "1"}
            onChange={(e) => update({ late: e.target.checked ? "1" : null })}
          />
          遅延のみ
        </label>
        {hasFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
          >
            <X aria-hidden />
            条件をクリア
          </Button>
        )}
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="検索中" />}
      </div>
    </div>
  );
}
