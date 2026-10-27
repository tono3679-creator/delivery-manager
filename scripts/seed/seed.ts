/**
 * デモデータの初期化。
 *   npm run db:seed                       … 既定の Seed 値で生成
 *   npm run db:seed -- --seed=12345       … Seed 値を指定
 *   npm run db:seed -- --now=2026-10-27T11:00:00+09:00   … 基準時刻を固定（再現確認用）
 *
 * 同じ Seed 値と基準時刻なら同じデータになる。
 * 接続先は DATABASE_URL（データベース所有者の接続文字列）。
 * ログイン用アカウント（管理者1名・ドライバー1名）も作成する。
 */
import postgres from "postgres";
import { DEFAULT_DEMO_SEED, generateDemoData } from "@/lib/demo/generator";
import { loadDataset } from "@/lib/demo/load";
import { createLoginUser } from "./users";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/** Seed 値から決まる固定の会社 ID（何度実行しても同じ会社を作り直す） */
export function showcaseCompanyId(seed: number): string {
  const hex = (seed >>> 0).toString(16).padStart(8, "0");
  return `00000000-0000-4000-8000-0000${hex}`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL を設定してください");
  const seed = Number(arg("seed") ?? DEFAULT_DEMO_SEED);
  const now = arg("now") ? new Date(arg("now") as string) : new Date();
  if (!Number.isFinite(seed) || Number.isNaN(now.getTime())) throw new Error("--seed / --now の値が不正です");

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const companyId = showcaseCompanyId(seed);
  const started = Date.now();
  const data = generateDemoData({ seed, now, companyId, isDemo: false });
  await loadDataset(sql, data);

  const admin = await createLoginUser(sql, {
    email: process.env.SEED_ADMIN_EMAIL ?? "admin@minato-express.example",
    password: process.env.SEED_ADMIN_PASSWORD ?? "demo-admin-2026",
  });
  const driver = await createLoginUser(sql, {
    email: process.env.SEED_DRIVER_EMAIL ?? "driver@minato-express.example",
    password: process.env.SEED_DRIVER_PASSWORD ?? "demo-driver-2026",
  });
  await sql`
    insert into public.profiles (id, company_id, role, driver_id, display_name)
    values (${admin}, ${companyId}, 'admin', null, '配車担当 佐々木'),
           (${driver}, ${companyId}, 'driver', ${data.featuredDriverId},
            (select name from public.drivers where id = ${data.featuredDriverId}))
    on conflict (id) do update set company_id = excluded.company_id, role = excluded.role,
      driver_id = excluded.driver_id, display_name = excluded.display_name`;

  console.log(
    `seed=${seed} 基準時刻=${now.toISOString()} 会社=${companyId}\n` +
      `案件 ${data.orders.length} 件 / 履歴 ${data.statusLogs.length} 件 / 経費 ${data.expenses.length} 件` +
      `（${((Date.now() - started) / 1000).toFixed(1)} 秒）`,
  );
  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
