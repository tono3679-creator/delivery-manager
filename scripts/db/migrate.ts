/**
 * データベースのマイグレーション。
 *   npm run db:migrate          … DATABASE_URL（無ければ .env.local）の DB に適用する
 *
 * 1. db/bootstrap.sql（ロールと auth スキーマ。新しい DB に最初の1回だけ）
 * 2. db/migrations/*.sql のうち、まだ適用していないものを名前の順に1ファイルずつ（ファイルごとに1トランザクション）
 * 適用済みのファイルは app_meta.migrations に記録する。
 * bootstrap.sql は「これから作る表に権限を付ける」既定を含み、マイグレーション 0012 がそれを締め直しているため、
 * 2回目以降に実行すると締め直しが戻ってしまう。そのため最初の1回だけ実行する。
 * 公開環境（Vercel）ではビルドの前に自動で実行する（scripts/deploy/vercel-build.ts）。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres, { type Sql } from "postgres";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BOOTSTRAP = "db/bootstrap.sql";

export async function migrate(sql: Sql, log: (line: string) => void = console.log): Promise<string[]> {
  // 同時に2つ実行されても、片方が終わるまで待つ（ビルドが重なったときなど）
  await sql`select pg_advisory_lock(hashtext('delivery-manager:migrate'))`;
  try {
    await sql`create schema if not exists app_meta`;
    await sql`revoke all on schema app_meta from public`;
    await sql`create table if not exists app_meta.migrations (name text primary key, applied_at timestamptz not null default now())`;

    const done = new Set((await sql<{ name: string }[]>`select name from app_meta.migrations`).map((r) => r.name));
    if (!done.has(BOOTSTRAP)) {
      const body = done.size === 0 ? await readFile(path.join(ROOT, BOOTSTRAP), "utf8") : null;
      await sql.begin(async (tx) => {
        if (body) await tx.unsafe(body);
        await tx`insert into app_meta.migrations (name) values (${BOOTSTRAP})`;
      });
      if (body) log(`適用: ${BOOTSTRAP}`);
    }
    const files = (await readdir(path.join(ROOT, "db/migrations"))).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const body = await readFile(path.join(ROOT, "db/migrations", file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into app_meta.migrations (name) values (${file})`;
      });
      applied.push(file);
      log(`適用: ${file}`);
    }
    if (applied.length === 0) log("マイグレーション：新しいものはありません");
    return applied;
  } finally {
    await sql`select pg_advisory_unlock(hashtext('delivery-manager:migrate'))`;
  }
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL を設定してください");
  // 接続プーラーを通さない接続（Neon の DATABASE_URL_UNPOOLED）があればそちらを使う
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(sql);
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
