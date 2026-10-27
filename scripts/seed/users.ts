import type { Sql } from "postgres";

/**
 * ログイン用ユーザーを作成し、その ID を返す。
 * SUPABASE_SERVICE_ROLE_KEY（Secret key または従来の service_role キー）があれば Supabase Auth の管理 API を使い、
 * 既にあるユーザーはパスワードを指定の値に合わせる（パスワードを変えて再実行できるように）。
 * 無ければローカル検証用の auth.users に直接登録する（既にあればそのまま）。
 */
export async function createLoginUser(sql: Sql, user: { email: string; password: string }): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const existing = await sql<{ id: string }[]>`select id from auth.users where email = ${user.email}`;

  if (url && serviceKey) {
    const id = existing[0]?.id;
    const res = await fetch(id ? `${url}/auth/v1/admin/users/${id}` : `${url}/auth/v1/admin/users`, {
      method: id ? "PUT" : "POST",
      // 新しい Secret key（sb_secret_…）は JWT ではないので apikey ヘッダーだけで送る。従来の service_role キーは両方に付ける
      headers: {
        apikey: serviceKey,
        ...(serviceKey.startsWith("sb_") ? {} : { Authorization: `Bearer ${serviceKey}` }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: user.email, password: user.password, email_confirm: true }),
    });
    if (!res.ok) throw new Error(`ログイン用アカウント（${user.email}）の作成に失敗しました: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { id: string };
    return body.id;
  }

  if (existing.length > 0) return existing[0].id;
  const rows = await sql<{ id: string }[]>`
    insert into auth.users (email, encrypted_password)
    values (${user.email}, extensions.crypt(${user.password}, extensions.gen_salt('bf')))
    returning id`;
  return rows[0].id;
}
