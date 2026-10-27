import type { Sql } from "postgres";

/**
 * ログイン用ユーザーを作成し、その ID を返す（既にあれば既存の ID）。
 * SUPABASE_SERVICE_ROLE_KEY があれば Supabase Auth の管理 API を使う。
 * 無ければローカル検証用の auth.users に直接登録する。
 */
export async function createLoginUser(sql: Sql, user: { email: string; password: string }): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const existing = await sql<{ id: string }[]>`select id from auth.users where email = ${user.email}`;
  if (existing.length > 0) return existing[0].id;

  if (url && serviceKey) {
    const res = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: user.password, email_confirm: true }),
    });
    if (!res.ok) throw new Error(`ユーザー作成に失敗しました: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  const rows = await sql<{ id: string }[]>`
    insert into auth.users (email, encrypted_password)
    values (${user.email}, extensions.crypt(${user.password}, extensions.gen_salt('bf')))
    returning id`;
  return rows[0].id;
}
