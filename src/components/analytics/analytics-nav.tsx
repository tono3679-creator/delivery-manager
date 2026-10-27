import Link from "next/link";
import { cn } from "@/lib/utils";

/** 売上分析と経費一覧の切り替え（集計期間は引き継ぐ） */
export function AnalyticsNav({ current, query }: { current: "sales" | "expenses"; query: string }) {
  const items = [
    { key: "sales", href: "/analytics", label: "売上・利益" },
    { key: "expenses", href: "/analytics/expenses", label: "経費の一覧・登録" },
  ] as const;
  return (
    <nav aria-label="分析メニュー" className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground">
      {items.map((i) => (
        <Link
          key={i.key}
          href={query ? `${i.href}?${query}` : i.href}
          aria-current={current === i.key ? "page" : undefined}
          className={cn(
            "inline-flex h-7 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors",
            current === i.key ? "bg-card text-foreground shadow-xs" : "hover:text-foreground",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
