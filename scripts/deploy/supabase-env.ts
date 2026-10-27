/**
 * 公開環境の DB セットアップ（.github/workflows/production-db.yml）で使う、接続情報の確認。
 * 秘密の値そのものはログに出さない。
 */

export type DbUrlCheck = { ok: true; projectRef: string; supabaseUrl: string } | { ok: false; error: string };

/**
 * Supabase の接続文字列を確かめ、プロジェクトの URL（https://<ref>.supabase.co）を求める。
 *   Session pooler：postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
 *   直接接続：      postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres（IPv6 のみ。GitHub Actions からは届かない）
 */
export function checkSupabaseDbUrl(value: string | undefined): DbUrlCheck {
  if (!value) return { ok: false, error: "SUPABASE_DB_URL が登録されていません" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "SUPABASE_DB_URL が接続文字列（postgresql://…）の形になっていません" };
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return { ok: false, error: "SUPABASE_DB_URL は postgresql:// で始まる接続文字列にしてください" };
  }
  const password = decodeURIComponent(url.password);
  if (!password || /^\[?YOUR-PASSWORD\]?$/i.test(password)) {
    return { ok: false, error: "SUPABASE_DB_URL の [YOUR-PASSWORD] を、プロジェクト作成時に決めた DB のパスワードに置き換えてください" };
  }
  if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(url.hostname)) {
    return {
      ok: false,
      error: "直接接続（db.….supabase.co）は IPv6 専用で、GitHub Actions からは接続できません。Connect 画面の Session pooler の接続文字列を登録してください",
    };
  }
  if (url.port === "6543") {
    return {
      ok: false,
      error: "ポート 6543 は Transaction pooler（Vercel 用）です。マイグレーションには Session pooler（ポート 5432）の接続文字列を登録してください",
    };
  }
  const user = decodeURIComponent(url.username);
  const match = /^postgres\.([a-z0-9]{20})$/.exec(user);
  if (!match) {
    return { ok: false, error: "SUPABASE_DB_URL のユーザー名が postgres.<プロジェクト ID> になっていません。Session pooler の接続文字列を登録してください" };
  }
  const projectRef = match[1];
  return { ok: true, projectRef, supabaseUrl: `https://${projectRef}.supabase.co` };
}

/** 見本の会社にログインするアカウントのパスワード */
export function checkLoginPassword(value: string | undefined): string | null {
  if (!value) return "SEED_LOGIN_PASSWORD が登録されていません";
  if (value.length < 8) return "SEED_LOGIN_PASSWORD は 8 文字以上にしてください";
  if (["demo-admin-2026", "demo-driver-2026"].includes(value)) {
    return "SEED_LOGIN_PASSWORD に README に載っている既定のパスワードは使えません";
  }
  return null;
}

/** Supabase の Secret key（sb_secret_…）か、従来の service_role キー（JWT） */
export function checkSecretKey(value: string | undefined): string | null {
  if (!value) return "SUPABASE_SECRET_KEY が登録されていません";
  if (value.startsWith("sb_publishable_")) return "SUPABASE_SECRET_KEY に Publishable key が登録されています。Secret key を登録してください";
  if (!value.startsWith("sb_secret_") && value.split(".").length !== 3) {
    return "SUPABASE_SECRET_KEY が Secret key（sb_secret_…）の形になっていません";
  }
  return null;
}
