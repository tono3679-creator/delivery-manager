/**
 * 公開環境の DB セットアップの前に、登録された Secrets を確かめる（値はログに出さない）。
 * 問題がなければ、Supabase の URL を後続のステップに渡す（GITHUB_ENV）。
 *   npx tsx scripts/deploy/check-env.ts
 */
import { appendFileSync } from "node:fs";
import { checkLoginPassword, checkSecretKey, checkSupabaseDbUrl } from "./supabase-env";

const db = checkSupabaseDbUrl(process.env.SUPABASE_DB_URL);
const errors = [
  db.ok ? null : db.error,
  checkSecretKey(process.env.SUPABASE_SECRET_KEY),
  checkLoginPassword(process.env.SEED_LOGIN_PASSWORD),
].filter((e): e is string => e !== null);

if (errors.length > 0 || !db.ok) {
  for (const e of errors) console.log(`::error::${e}`);
  process.exit(1);
}

console.log(`Supabase プロジェクト: ${db.projectRef}（${db.supabaseUrl}）`);
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `NEXT_PUBLIC_SUPABASE_URL=${db.supabaseUrl}\n`);
