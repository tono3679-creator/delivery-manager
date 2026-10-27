"use server";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { asAdmin, getCurrentUser } from "@/lib/auth";
import { asUser } from "@/lib/db";

/**
 * 遅延の通知を作る（配送予定 + 15 分を過ぎても完了していない案件。1案件につき1回）。
 * 時間の経過で起きることなので、管理者の画面から定期的に呼ぶ。戻り値は新しく作った通知の件数。
 */
export async function syncLateAlerts(): Promise<number> {
  try {
    const [row] = await asAdmin((tx) => tx<{ n: number }[]>`select refresh_late_alerts() n`);
    return row?.n ?? 0;
  } catch (e) {
    unstable_rethrow(e);
    // 画面の表示には影響させない（次の呼び出しで再度確認する）
    console.error(e);
    return 0;
  }
}

/** 1件の通知を既読にする（RLS により本人宛ての通知だけ） */
export async function markNotificationRead(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  const user = await getCurrentUser();
  if (!user) return;
  await asUser(user.userId, (tx) => tx`update notifications set read_at = now() where id = ${id} and read_at is null`);
}
