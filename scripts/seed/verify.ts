/**
 * デモデータの整合性チェック。違反が1件でもあれば終了コード 1。
 *   npm run db:verify
 */
import path from "node:path";
import postgres, { type Sql } from "postgres";
import { INTEGRITY_CHECKS } from "./checks";

/** すべてのチェックを実行し、違反のあったチェックの数を返す */
export async function verifyIntegrity(sql: Sql, log: (line: string) => void = console.log): Promise<number> {
  let failed = 0;
  for (const check of INTEGRITY_CHECKS) {
    const [row] = await sql.unsafe<{ n: string }[]>(check.sql);
    const n = Number(row.n);
    if (n > 0) failed++;
    log(`${n === 0 ? "OK " : "NG "} ${check.label}${n > 0 ? `（${n} 件）` : ""}`);
  }
  return failed;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL を設定してください");
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const failed = await verifyIntegrity(sql).finally(() => sql.end());
  if (failed > 0) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
