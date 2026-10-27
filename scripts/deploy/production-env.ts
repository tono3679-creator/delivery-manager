/**
 * 公開環境（Vercel）の環境変数の確認。秘密の値そのものはログに出さない。
 *   DATABASE_URL           Neon の接続文字列（Vercel の Storage から Neon を追加すると自動で入る）
 *   DATABASE_URL_UNPOOLED  同じ DB への、接続プーラーを通さない接続（同上。マイグレーションに使う）
 *   SEED_LOGIN_PASSWORD    見本の会社にログインするアカウント（管理者・ドライバー）のパスワード
 *   CRON_SECRET            期限切れのデモを消す定期処理（Vercel Cron）の合言葉
 */
import { isLocalDatabase, seedPasswords, type Env } from "../seed/users";

export const MIN_CRON_SECRET_LENGTH = 16;

function checkDatabaseUrl(name: string, value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${name} が接続文字列（postgresql://…）の形になっていません`;
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return `${name} は postgresql:// で始まる接続文字列にしてください`;
  if (isLocalDatabase(value)) return `${name} が localhost を指しています。公開環境からは届きません`;
  return null;
}

/** 足りない・使えない設定の一覧（問題がなければ空） */
export function checkProductionEnv(env: Env): string[] {
  const errors: (string | null)[] = [];
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    errors.push("DATABASE_URL がありません。Vercel の Storage から Neon を追加して、このプロジェクトにつないでください");
  } else {
    errors.push(checkDatabaseUrl("DATABASE_URL", databaseUrl));
    if (env.DATABASE_URL_UNPOOLED) errors.push(checkDatabaseUrl("DATABASE_URL_UNPOOLED", env.DATABASE_URL_UNPOOLED));
  }
  try {
    // 接続先に関係なく、公開環境の決まり（既定値は使えない・一定の長さ以上）で確かめる
    seedPasswords(env, "postgresql://public.invalid/db");
  } catch (error) {
    errors.push((error as Error).message);
  }
  const cron = env.CRON_SECRET;
  if (!cron) errors.push(`CRON_SECRET を設定してください（${MIN_CRON_SECRET_LENGTH}文字以上のランダムな文字列。期限切れのデモの削除に使います）`);
  else if (cron.length < MIN_CRON_SECRET_LENGTH) errors.push(`CRON_SECRET は ${MIN_CRON_SECRET_LENGTH} 文字以上にしてください`);
  return errors.filter((e): e is string => e !== null);
}
