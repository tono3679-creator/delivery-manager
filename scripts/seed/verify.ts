/**
 * デモデータの整合性チェック。違反が1件でもあれば終了コード 1。
 *   npm run db:verify
 */
import postgres from "postgres";
import { INTEGRITY_CHECKS } from "./checks";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL を設定してください");
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  let failed = 0;
  for (const check of INTEGRITY_CHECKS) {
    const [row] = await sql.unsafe<{ n: string }[]>(check.sql);
    const n = Number(row.n);
    if (n > 0) failed++;
    console.log(`${n === 0 ? "OK " : "NG "} ${check.label}${n > 0 ? `（${n} 件）` : ""}`);
  }
  await sql.end();
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
