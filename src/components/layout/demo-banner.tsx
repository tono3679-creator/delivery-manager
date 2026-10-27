"use client";
import { useTransition } from "react";
import { FlaskConical, Smartphone, LayoutDashboard } from "lucide-react";
import { switchDemoRole } from "@/lib/actions/session";
import { cn } from "@/lib/utils";

/** デモ環境であることを常に表示し、管理者⇔ドライバーをワンタップで切り替えられるようにする */
export function DemoBanner({ role, className }: { role: "admin" | "driver"; className?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 bg-warning-soft px-4 py-2 text-xs text-warning-strong sm:px-6", className)} role="note">
      <span className="flex items-center gap-1.5 font-semibold">
        <FlaskConical className="size-3.5" aria-hidden />
        デモ環境
      </span>
      <span className="text-keep hidden sm:inline">表示中の会社・人物・住所・地図上の位置はすべて架空です。データはあなた専用で、24時間後に自動で削除されます。</span>
      <span className="text-keep sm:hidden">データはすべて架空です</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => switchDemoRole(role === "admin" ? "driver" : "admin"))}
        className="ml-auto inline-flex items-center gap-1 rounded-full border border-warning/40 bg-card px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
      >
        {role === "admin" ? <Smartphone className="size-3.5" aria-hidden /> : <LayoutDashboard className="size-3.5" aria-hidden />}
        {pending ? "切り替え中…" : role === "admin" ? "ドライバー画面を体験" : "管理者画面に戻る"}
      </button>
    </div>
  );
}
