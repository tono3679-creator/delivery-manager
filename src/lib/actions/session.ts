"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/db";
import { getAuthUserId, getCurrentUser } from "@/lib/auth";
import { createDemoSandbox } from "@/lib/demo/sandbox";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

const loginSchema = z.object({
  email: z.email("メールアドレスの形式が正しくありません"),
  password: z.string().min(1, "パスワードを入力してください"),
});

export async function signInWithPassword(input: z.infer<typeof loginSchema>): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "入力内容を確認してください" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, error: "メールアドレスまたはパスワードが正しくありません" };
  redirect("/");
}

/** デモを開始する：匿名ログイン → 訪問者専用のデモ会社を作成 */
export async function startDemo(role: "admin" | "driver"): Promise<ActionResult> {
  if (role !== "admin" && role !== "driver") return { ok: false, error: "不正な操作です" };
  const supabase = await createSupabaseServerClient();
  let auth = await getAuthUserId();
  if (!auth) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      return { ok: false, error: "デモを開始できませんでした。時間をおいて再度お試しください" };
    }
    auth = { id: data.user.id, isAnonymous: true };
  }
  try {
    await createDemoSandbox(auth.id, role);
  } catch (e) {
    console.error(e);
    return { ok: false, error: "デモデータの準備に失敗しました。時間をおいて再度お試しください" };
  }
  redirect(role === "admin" ? "/dashboard" : "/driver");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** デモ環境のみ：管理者⇔ドライバーの切り替え（DB 側でデモ会社かを確認する） */
export async function switchDemoRole(role: "admin" | "driver"): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.isDemo) redirect("/login");
  await asUser(user.userId, (tx) => tx`select demo_switch_role(${role}::app_role)`);
  revalidatePath("/", "layout");
  redirect(role === "admin" ? "/dashboard" : "/driver");
}

export async function resetDemo(): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.isDemo) redirect("/login");
  await createDemoSandbox(user.userId, user.role);
  revalidatePath("/", "layout");
}

export async function markNotificationsRead(audience: "admin" | "driver"): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await asUser(user.userId, (tx) =>
    audience === "admin"
      ? tx`update notifications set read_at = now() where audience = 'admin' and read_at is null`
      : tx`update notifications set read_at = now() where audience = 'driver' and driver_id = ${user.driverId} and read_at is null`,
  );
  revalidatePath("/", "layout");
}
