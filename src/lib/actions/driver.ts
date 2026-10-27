"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { asDriver } from "@/lib/auth";
import { driverActions } from "@/lib/domain/status";
import { noteSchema, statusChangeSchema } from "@/lib/validation/order";
import { toUserMessage } from "./errors";

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateDriver(orderId: string) {
  revalidatePath("/driver", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/dispatch");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}

/**
 * ドライバーによるステータス更新（集荷完了・配送開始・配送完了・配送失敗）。
 * 実際の権限・遷移・本人確認は DB の driver_update_status() が行う（画面の表示に依存しない）。
 */
export async function driverUpdateStatus(input: z.input<typeof statusChangeSchema>): Promise<ActionResult> {
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "不正な操作です" };
  const { orderId, expected, to, note } = parsed.data;
  const action = driverActions(expected).find((a) => a.to === to);
  if (!action) return { ok: false, error: "この操作はできません。画面を更新してください" };
  if (action.requiresNote && !note) return { ok: false, error: "理由を入力してください" };
  try {
    await asDriver((tx) => tx`select driver_update_status(${orderId}, ${expected}, ${to}, ${note ?? null})`);
    revalidateDriver(orderId);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "ステータスを更新できませんでした") };
  }
}

export async function addDriverNote(input: z.input<typeof noteSchema>): Promise<ActionResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "入力内容を確認してください" };
  try {
    await asDriver((tx, user) => tx`
      insert into delivery_notes (company_id, order_id, author_id, author_name, body)
      values (${user.companyId}, ${parsed.data.orderId}, ${user.userId}, ${user.displayName}, ${parsed.data.body})`);
    revalidatePath(`/driver/orders/${parsed.data.orderId}`);
    revalidatePath(`/orders/${parsed.data.orderId}`);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "メモを保存できませんでした") };
  }
}
