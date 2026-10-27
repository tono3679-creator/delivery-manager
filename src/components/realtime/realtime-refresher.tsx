"use client";
/**
 * 配送案件・通知の変更を画面に反映する（定期的な再取得）。
 * - 画面を開いている間は 30 秒ごとに再取得する（裏に回っている間・10分以上操作がない間は止める。lib/hooks/idle.ts）
 * - 画面に戻ったとき・操作を再開したとき・通信が回復したときはすぐに再取得する（表示は常に DB の内容が正）
 * - 自分の操作（ステータス更新など）はサーバーの処理の中で再取得されるので、待たずに反映される
 * - 最後に DB から取得した時刻（syncedAt：サーバーで描画した時刻）を表示に使う
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff } from "lucide-react";
import { isIdle, onResume, shouldPoll } from "@/lib/hooks/idle";
import { useOnline } from "@/lib/hooks/use-online";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** 再取得の間隔 */
export const POLL_INTERVAL_MS = 30_000;

type Status = "polling" | "paused" | "offline";
type Sync = { status: Status; online: boolean; syncedAt: string | null };
const SyncContext = createContext<Sync>({ status: "polling", online: true, syncedAt: null });

/** 通信状態と最終更新時刻（ステータス操作のボタンを止める・表示が古いことを伝えるのに使う） */
export function useSyncState(): Sync {
  return useContext(SyncContext);
}

export function RealtimeRefresher({ syncedAt, children }: { syncedAt: string; children: React.ReactNode }) {
  const online = useOnline();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      // 続けて起きたきっかけ（画面復帰と通信の回復など）はまとめて1回だけ再取得する
      timer.current = setTimeout(() => router.refresh(), 400);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    const poll = setInterval(() => {
      if (isIdle()) setPaused(true);
      else if (shouldPoll()) router.refresh();
    }, POLL_INTERVAL_MS);
    const stopResume = onResume(() => {
      setPaused(false);
      refresh();
    });

    return () => {
      clearInterval(poll);
      stopResume();
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [router]);

  const status: Status = !online ? "offline" : paused ? "paused" : "polling";
  return <SyncContext value={{ status, online, syncedAt }}>{children}</SyncContext>;
}

const LABEL: Record<Status, string> = {
  polling: "自動更新（30秒ごと）",
  paused: "自動更新を停止中（操作すると再開）",
  offline: "オフライン",
};

export function RealtimeIndicator({ className }: { className?: string }) {
  const { status, syncedAt } = useSyncState();
  return (
    <div className={cn("items-center gap-1.5 text-xs text-muted-foreground", className)} aria-live="polite">
      <span
        className={cn(
          "size-2 rounded-full",
          status === "polling" && "bg-brand",
          status === "paused" && "bg-muted-foreground",
          status === "offline" && "animate-pulse bg-warning",
        )}
        aria-hidden
      />
      {LABEL[status]}
      {syncedAt && <span className="tabular">・{formatTime(syncedAt)} 更新</span>}
    </div>
  );
}

/**
 * 通信できないときの帯。表示が最後に取得した時点の内容であること、操作は通信が戻ってから行うことを伝える。
 * 通信が戻ると自動で再取得する（RealtimeRefresher）。
 */
export function OfflineBanner({ className }: { className?: string }) {
  const { online, syncedAt } = useSyncState();
  if (online) return null;
  return (
    <div role="status" className={cn("flex items-start gap-2 bg-warning-soft px-4 py-2 text-sm text-warning-strong", className)}>
      <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <strong className="font-semibold">通信できません。</strong>
        表示は{syncedAt ? ` ${formatTime(syncedAt)} ` : ""}時点の内容です。ステータスの更新は通信が戻ってから行ってください（戻ると自動で最新になります）。
      </p>
    </div>
  );
}
