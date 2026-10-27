import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** 詳細画面の「一覧へ戻る」 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </Link>
  );
}

/** 詳細画面の項目（dl の中で使う） */
export function DetailItem({ icon: Icon, label, children, className }: { icon: LucideIcon; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 gap-3", className)}>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-words">{children}</dd>
      </div>
    </div>
  );
}

/** 詳細画面の小さな数字（今月の実績など） */
export function MiniStat({ label, value, sub, tone, className }: { label: string; value: string; sub?: React.ReactNode; tone?: "danger" | "warning"; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-lg border bg-card px-3.5 py-3", className)}>
      <div className="text-keep text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-1 tabular text-lg font-bold whitespace-nowrap", tone === "danger" && "text-danger-strong", tone === "warning" && "text-warning-strong")}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Muted({ children = "—" }: { children?: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
