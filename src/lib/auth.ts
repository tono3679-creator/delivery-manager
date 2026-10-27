import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { asUser, type Tx } from "@/lib/db";
import type { AppRole } from "@/lib/domain/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CurrentUser = {
  userId: string;
  role: AppRole;
  companyId: string;
  companyName: string;
  driverId: string | null;
  displayName: string;
  isDemo: boolean;
  isAnonymous: boolean;
};

/** Supabase Auth のセッションを検証してユーザー ID を返す */
export const getAuthUserId = cache(async (): Promise<{ id: string; isAnonymous: boolean } | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, isAnonymous: Boolean(data.claims.is_anonymous) };
});

/** ログイン中のユーザーと所属会社（未ログイン・未登録なら null） */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const auth = await getAuthUserId();
  if (!auth) return null;
  const rows = await asUser(auth.id, (tx) => tx<{
    role: AppRole; company_id: string; company_name: string; driver_id: string | null;
    display_name: string; is_demo: boolean;
  }[]>`
    select p.role, p.company_id, c.name company_name, p.driver_id, p.display_name, c.is_demo
      from profiles p join companies c on c.id = p.company_id
     where p.id = ${auth.id}`);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: auth.id,
    role: row.role,
    companyId: row.company_id,
    companyName: row.company_name,
    driverId: row.driver_id,
    displayName: row.display_name,
    isDemo: row.is_demo,
    isAnonymous: auth.isAnonymous,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/driver");
  return user;
}

export async function requireDriver(): Promise<CurrentUser & { driverId: string }> {
  const user = await requireUser();
  if (user.role !== "driver" || !user.driverId) redirect("/dashboard");
  return user as CurrentUser & { driverId: string };
}

/**
 * API（Route Handler）用の管理者チェック。画面と違ってリダイレクトせず、401 / 403 の JSON を返せるようにする。
 * 戻り値が Response のときはそのまま返す。
 */
export async function adminApiGuard(): Promise<Response | null> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "ログインしてください" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "この操作を行う権限がありません" }, { status: 403 });
  return null;
}

/** 管理者として RLS 付きで実行（Server Actions とデータ取得の入口） */
export async function asAdmin<T>(fn: (tx: Tx, user: CurrentUser) => Promise<T>): Promise<T> {
  const user = await requireAdmin();
  return asUser(user.userId, (tx) => fn(tx, user));
}

export async function asDriver<T>(fn: (tx: Tx, user: CurrentUser & { driverId: string }) => Promise<T>): Promise<T> {
  const user = await requireDriver();
  return asUser(user.userId, (tx) => fn(tx, user));
}
