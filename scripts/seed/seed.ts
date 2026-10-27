/**
 * デモデータの初期化。
 *   npm run db:seed                       … 既定の Seed 値で生成
 *   npm run db:seed -- --seed=12345       … Seed 値を指定
 *   npm run db:seed -- --now=2026-10-27T11:00:00+09:00   … 基準時刻を固定（再現確認用）
 *
 * 同じ Seed 値と基準時刻なら同じデータになる。
 * 接続先は DATABASE_URL（データベース所有者の接続文字列）。
 * ログイン用アカウント（管理者1名・ドライバー1名）も作成する。パスワードの決め方は users.ts の seedPasswords。
 * 公開環境（Vercel）ではビルドのたびに自動で実行する（scripts/deploy/vercel-build.ts）。
 */
import path from "node:path";
import postgres, { type Sql } from "postgres";
import { DEFAULT_DEMO_SEED, generateDemoData } from "@/lib/demo/generator";
import { loadDataset } from "@/lib/demo/load";
import { createLoginUser, seedPasswords } from "./users";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/** Seed 値から決まる固定の会社 ID（何度実行しても同じ会社を作り直す） */
export function showcaseCompanyId(seed: number): string {
  const hex = (seed >>> 0).toString(16).padStart(8, "0");
  return `00000000-0000-4000-8000-0000${hex}`;
}

/** 見本の会社を「now」を基準に作り直し、ログイン用アカウントを紐づける */
export async function seedShowcase(
  sql: Sql,
  options: { seed: number; now: Date; passwords: { admin: string; driver: string }; log?: (line: string) => void },
): Promise<void> {
  const { seed, now, passwords, log = console.log } = options;
  const companyId = showcaseCompanyId(seed);
  const started = Date.now();
  const data = generateDemoData({ seed, now, companyId, isDemo: false });
  await loadDataset(sql, data);

  const admin = await createLoginUser(sql, {
    email: process.env.SEED_ADMIN_EMAIL ?? "admin@minato-express.example",
    password: passwords.admin,
  });
  const driver = await createLoginUser(sql, {
    email: process.env.SEED_DRIVER_EMAIL ?? "driver@minato-express.example",
    password: passwords.driver,
  });
  await sql`
    insert into public.profiles (id, company_id, role, driver_id, display_name)
    values (${admin}, ${companyId}, 'admin', null, '配車担当 佐々木'),
           (${driver}, ${companyId}, 'driver', ${data.featuredDriverId},
            (select name from public.drivers where id = ${data.featuredDriverId}))
    on conflict (id) do update set company_id = excluded.company_id, role = excluded.role,
      driver_id = excluded.driver_id, display_name = excluded.display_name`;

  log(
    `seed=${seed} 基準時刻=${now.toISOString()} 会社=${companyId}\n` +
      `案件 ${data.orders.length} 件 / 履歴 ${data.statusLogs.length} 件 / 経費 ${data.expenses.length} 件 / 請求 ${data.invoices.length} 件` +
      `（${((Date.now() - started) / 1000).toFixed(1)} 秒）`,
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL を設定してください");
  const seed = Number(arg("seed") ?? DEFAULT_DEMO_SEED);
  const now = arg("now") ? new Date(arg("now") as string) : new Date();
  if (!Number.isFinite(seed) || Number.isNaN(now.getTime())) throw new Error("--seed / --now の値が不正です");
  // データを入れる前に確かめる
  const passwords = seedPasswords(process.env, url);

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await seedShowcase(sql, { seed, now, passwords });
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
