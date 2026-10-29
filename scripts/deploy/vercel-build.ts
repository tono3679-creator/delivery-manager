/**
 * Vercel でのビルドの前処理（package.json の vercel-build。Vercel は build の代わりにこれを実行する）。
 * 本番（VERCEL_ENV=production）のときだけ、アプリをビルドする前に DB を最新にする：
 *   1. 環境変数の確認（足りなければここで止め、何を設定すればよいかをログに出す）
 *   2. マイグレーション（適用済みのものは飛ばす）
 *   3. 見本の会社を「今」を基準に作り直す（公開のたびに日付が新しくなる）
 *   4. デモデータの整合性チェック
 * プレビュー（ブランチごとの公開）では DB を変更しない（まだ取り込んでいない変更で本番の DB を書き換えないため）。
 * このあと vercel-build の続きで next build を実行する。
 */
import postgres from "postgres";
import { DEFAULT_DEMO_SEED } from "@/lib/demo/generator";
import { migrate } from "../db/migrate";
import { seedShowcase } from "../seed/seed";
import { seedPasswords } from "../seed/users";
import { verifyIntegrity } from "../seed/verify";
import { checkProductionEnv } from "./production-env";

async function main() {
  const target = process.env.VERCEL_ENV;
  if (target !== "production") {
    console.log(`DB の準備：本番ではない（${target ?? "Vercel の外"}）ため、DB は変更しません`);
    return;
  }
  const errors = checkProductionEnv(process.env);
  if (errors.length > 0) {
    console.error("公開に必要な設定が足りません（Vercel の Settings → Environment Variables で設定し、Redeploy してください）：");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const url = (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL) as string;
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(sql);
    await seedShowcase(sql, { seed: DEFAULT_DEMO_SEED, now: new Date(), passwords: seedPasswords(process.env, url) });
    const failed = await verifyIntegrity(sql);
    if (failed > 0) throw new Error(`デモデータの整合性チェックで ${failed} 件の違反がありました`);
  } finally {
    await sql.end();
  }
  console.log("DB の準備ができました");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
