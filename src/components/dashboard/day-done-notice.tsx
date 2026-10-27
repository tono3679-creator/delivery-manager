import Link from "next/link";
import { ArrowRight, CircleCheckBig } from "lucide-react";
import { formatDateShort, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * 本日の配送がすべて終わったとき（夜に開いたときなど）の案内。
 * 地図が完了のマーカーだけになるので、次の日の予定へすぐ移れるようにする。
 */
export function DayDoneNotice({
  delivered, failed, nextDay, nextCount, nextUnassigned, view = "board", className,
}: {
  delivered: number;
  failed: number;
  nextDay: string;
  nextCount: number;
  nextUnassigned: number;
  view?: "board" | "map";
  className?: string;
}) {
  const href = `/dispatch?date=${nextDay}${view === "map" ? "&view=map" : ""}`;
  return (
    <div role="status" className={cn("flex flex-col gap-1 rounded-lg border border-success/30 bg-success-soft/60 px-3 py-2.5 text-sm", className)}>
      <p className="flex items-start gap-2">
        <CircleCheckBig className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <span className="text-keep">
          本日の配送はすべて終わりました（完了 {formatNumber(delivered)}件{failed > 0 && `・失敗 ${formatNumber(failed)}件`}）
        </span>
      </p>
      {nextCount > 0 && (
        <Link href={href} className="text-keep pl-6 font-medium text-brand hover:underline">
          明日（{formatDateShort(nextDay)}）の予定 {formatNumber(nextCount)}件
          {nextUnassigned > 0 && <span className="text-warning-strong">（未割当 {formatNumber(nextUnassigned)}件）</span>}
          を見る
          <ArrowRight className="ml-0.5 inline size-4 align-[-3px]" aria-hidden />
        </Link>
      )}
    </div>
  );
}
