import type { Sql } from "postgres";
import { hashPassword, verifyPassword } from "@/lib/password";

/** 環境変数（process.env やテスト用の値） */
export type Env = Record<string, string | undefined>;

/** README に載っていて誰でも分かる、ローカル用の既定のパスワード */
export const LOCAL_DEFAULT_PASSWORDS = { admin: "demo-admin-2026", driver: "demo-driver-2026" } as const;
/** 公開環境のログイン用パスワードの最短の長さ */
export const MIN_PUBLIC_PASSWORD_LENGTH = 12;

/**
 * ログイン用ユーザーを作成し、その ID を返す。パスワードは scrypt で保存する（src/lib/password.ts）。
 * 既にいるユーザーは、パスワードが違えば指定の値に合わせ、その利用者のログイン中の端末をログアウトさせる
 * （同じパスワードなら何もしない。公開のたびに実行してもログイン中の人は追い出さない）。
 */
export async function createLoginUser(sql: Sql, user: { email: string; password: string }): Promise<string> {
  const email = user.email.trim().toLowerCase();
  const [existing] = await sql<{ id: string; encrypted_password: string | null }[]>`
    select id, encrypted_password from auth.users where lower(email) = ${email}`;
  if (existing) {
    if (await verifyPassword(user.password, existing.encrypted_password)) return existing.id;
    const hashed = await hashPassword(user.password);
    await sql.begin(async (tx) => {
      await tx`update auth.users set encrypted_password = ${hashed}, is_anonymous = false, updated_at = now() where id = ${existing.id}`;
      await tx`delete from auth.sessions where user_id = ${existing.id}`;
    });
    return existing.id;
  }
  const [row] = await sql<{ id: string }[]>`
    insert into auth.users (email, encrypted_password) values (${email}, ${await hashPassword(user.password)}) returning id`;
  return row.id;
}

/** 接続先が自分の PC の DB か（localhost など） */
export function isLocalDatabase(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** 公開環境で使えるパスワードか。使えなければ理由 */
export function checkLoginPassword(name: string, value: string | undefined): string | null {
  if (!value) return `${name} が設定されていません`;
  if (value.length < MIN_PUBLIC_PASSWORD_LENGTH) return `${name} は ${MIN_PUBLIC_PASSWORD_LENGTH} 文字以上にしてください`;
  if ((Object.values(LOCAL_DEFAULT_PASSWORDS) as string[]).includes(value)) return `${name} に README に載っている既定のパスワードは使えません`;
  return null;
}

/**
 * 見本の会社にログインするアカウント（管理者・ドライバー）のパスワード。
 *   SEED_LOGIN_PASSWORD：両方に使う。SEED_ADMIN_PASSWORD・SEED_DRIVER_PASSWORD があればそちらを優先
 * 自分の PC の DB なら、未設定のときは README の既定値を使う。
 * それ以外（公開環境）では既定値を使わず、短いパスワードも受け付けない（メールアドレスは README に載っているため）。
 */
export function seedPasswords(env: Env, databaseUrl: string): { admin: string; driver: string } {
  const admin = env.SEED_ADMIN_PASSWORD || env.SEED_LOGIN_PASSWORD;
  const driver = env.SEED_DRIVER_PASSWORD || env.SEED_LOGIN_PASSWORD;
  if (isLocalDatabase(databaseUrl)) {
    return { admin: admin || LOCAL_DEFAULT_PASSWORDS.admin, driver: driver || LOCAL_DEFAULT_PASSWORDS.driver };
  }
  const name = (specific: string) => (env[specific] ? specific : "SEED_LOGIN_PASSWORD");
  const error = checkLoginPassword(name("SEED_ADMIN_PASSWORD"), admin) ?? checkLoginPassword(name("SEED_DRIVER_PASSWORD"), driver);
  if (error) throw new Error(`${error}（公開環境では既定のパスワードを使いません）`);
  return { admin: admin as string, driver: driver as string };
}
