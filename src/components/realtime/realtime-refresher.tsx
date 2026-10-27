"use client";
/**
 * 配送案件・通知の変更を受け取って画面を最新にする。
 * - Supabase Realtime で変更を購読（RLS により自分が見られる行の変更だけが届く）
 * - 切断・再接続・画面復帰・通信の回復のときは必ず再取得する（表示は常に DB の内容が正）
 * - Realtime が使えない環境では 30 秒ごとに再取得する
 * - 最後に DB から取得した時刻（syncedAt：サーバーで描画した時刻）を表示に使う
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudOff } from "lucide-react";
import { useOnline } from "@/lib/hooks/use-online";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { realtimeEnabled } from "@/lib/supabase/config";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Status = "connecting" | "live" | "offline" | "polling";
type Sync = { status: Status; online: boolean; syncedAt: string | null };
const SyncContext = createContext<Sync>({ status: "connecting", online: true, syncedAt: null });

/** 通信状態と最終更新時刻（ステータス操作のボタンを止める・表示が古いことを伝えるのに使う） */
export function useSyncState(): Sync {
  return useContext(SyncContext);
}

export function RealtimeRefresher({
  filter, syncedAt, children,
}: { filter: { column: "company_id" | "driver_id"; value: string }; syncedAt: string; children: React.ReactNode }) {
  const online = useOnline();
  const router = useRouter();
  const [status, setStatus] = useState<Status>(realtimeEnabled ? "connecting" : "polling");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<Status>(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      // 連続した変更はまとめて1回だけ再取得する
      timer.current = setTimeout(() => router.refresh(), 400);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);

    let cleanup = () => {};
    if (realtimeEnabled) {
      const supabase = getSupabaseBrowserClient();
      const channel = supabase
        .channel(`orders:${filter.column}:${filter.value}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "delivery_orders", filter: `${filter.column}=eq.${filter.value}` }, refresh)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `${filter.column}=eq.${filter.value}` }, refresh)
        .subscribe((state) => {
          if (state === "SUBSCRIBED") {
            setStatus((prev) => {
              // 再接続できたら、切断中に起きた変更を取りこぼさないよう再取得
              if (prev === "offline") refresh();
              return "live";
            });
          } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
            setStatus("offline");
          }
        });
      cleanup = () => {
        supabase.removeChannel(channel);
      };
    }

    const poll = setInterval(() => {
      if (document.visibilityState === "visible" && (!realtimeEnabled || statusRef.current === "offline")) router.refresh();
    }, 30_000);

    return () => {
      cleanup();
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [filter.column, filter.value, router]);

  return <SyncContext value={{ status: online ? status : "offline", online, syncedAt }}>{children}</SyncContext>;
}

const LABEL: Record<Status, string> = {
  connecting: "接続中…",
  live: "リアルタイム更新中",
  offline: "再接続中（自動で再取得します）",
  polling: "自動更新（30秒ごと）",
};

export function RealtimeIndicator({ className }: { className?: string }) {
  const { status, online, syncedAt } = useSyncState();
  return (
    <div className={cn("items-center gap-1.5 text-xs text-muted-foreground", className)} aria-live="polite">
      <span
        className={cn(
          "size-2 rounded-full",
          status === "live" && "bg-success",
          status === "polling" && "bg-brand",
          status === "connecting" && "animate-pulse bg-muted-foreground",
          status === "offline" && "animate-pulse bg-warning",
        )}
        aria-hidden
      />
      {online ? LABEL[status] : "オフライン"}
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
