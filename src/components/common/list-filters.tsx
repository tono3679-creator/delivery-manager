"use client";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "__all";

export type FilterSelect = { key: string; label: string; allLabel: string; options: { value: string; label: string }[] };
export type FilterToggle = { key: string; label: string };

/**
 * 一覧画面の検索・絞り込み（ドライバー・車両・荷主・経費）。
 * 条件は URL に保存するので、再読み込みや共有をしても同じ結果になる。
 */
export function ListFilters({
  placeholder, selects = [], toggles = [], showSearch = true,
}: { placeholder?: string; selects?: FilterSelect[]; toggles?: FilterToggle[]; showSearch?: boolean }) {
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
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  // キーワードは入力が止まってから検索する
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => update({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const keys = [...(showSearch ? ["q"] : []), ...selects.map((s) => s.key), ...toggles.map((t) => t.key)];
  const hasFilter = keys.some((k) => params.get(k));

  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
      {showSearch && (
        <div className="relative sm:min-w-60 sm:flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" aria-label="キーワード検索" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {selects.map((s) => (
          <Select key={s.key} value={params.get(s.key) ?? ALL} onValueChange={(v) => update({ [s.key]: v })}>
            <SelectTrigger className="sm:w-auto sm:min-w-40" aria-label={`${s.label}で絞り込み`}><SelectValue placeholder={s.label} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{s.allLabel}</SelectItem>
              {s.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        ))}
        {toggles.map((t) => (
          <label key={t.key} className="flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm whitespace-nowrap">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={params.get(t.key) === "1"}
              onChange={(e) => update({ [t.key]: e.target.checked ? "1" : null })}
            />
            {t.label}
          </label>
        ))}
        {hasFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              const next = new URLSearchParams(params.toString());
              keys.forEach((k) => next.delete(k));
              next.delete("page");
              const qs = next.toString();
              startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
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
