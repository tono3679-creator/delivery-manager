"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { syncLateAlerts } from "@/lib/actions/notifications";
import { onResume, shouldPoll } from "@/lib/hooks/idle";

/**
 * 遅延の通知を作る（管理者の画面が開いている間、1分ごと。10分以上操作がない間は止め、操作を再開したらすぐ確認する）。
 * 遅延は「時間が過ぎた」ことで起きるため、データの変更を待つリアルタイム更新だけでは気づけない。
 * 新しく遅延になった案件があれば画面を更新し、通知・ダッシュボードの遅延件数に反映する。
 */
export function LateAlertSync({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    let running = false;
    const run = async () => {
      if (running || !shouldPoll()) return;
      running = true;
      try {
        const created = await syncLateAlerts();
        if (active && created > 0) router.refresh();
      } catch {
        // 通信できないときは次の回に確認する
      } finally {
        running = false;
      }
    };
    void run();
    const timer = setInterval(run, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    const stopResume = onResume(() => void run());
    return () => {
      active = false;
      clearInterval(timer);
      stopResume();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
  return null;
}
