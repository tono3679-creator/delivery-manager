import "server-only";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { serverEnv } from "@/lib/env";
import { runAsUser } from "./rls";

declare global {
  var __dmSql: Sql | undefined;
}

/**
 * データベース接続（サーバー専用）。
 * Vercel からは Supabase の接続プーラー（Transaction モード）を使うため prepare: false。
 */
export function db(): Sql {
  globalThis.__dmSql ??= postgres(serverEnv.databaseUrl, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    types: {
      // numeric（金額）は文字列ではなく数値で受け取る。円単位の整数なので誤差は出ない
      numeric: { to: 1700, from: [1700], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
      // bigint（count の結果）も数値で受け取る
      bigint: { to: 20, from: [20], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
    },
  });
  return globalThis.__dmSql;
}

export type Tx = TransactionSql;

/** ログインユーザーの権限（RLS）で実行する */
export function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runAsUser(db(), userId, fn);
}
