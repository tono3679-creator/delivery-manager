import "server-only";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { serverEnv } from "@/lib/env";
import { runAsUser } from "./rls";
import { toPostgresJsUrl } from "./url";
import { DB_TYPES } from "./types";

declare global {
  var __dmSql: Sql | undefined;
}

/**
 * データベース接続（サーバー専用）。
 * 公開環境では Neon の接続プーラー（PgBouncer の Transaction モード）を通すため prepare: false。
 */
export function db(): Sql {
  globalThis.__dmSql ??= postgres(toPostgresJsUrl(serverEnv.databaseUrl), {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    types: DB_TYPES,
  });
  return globalThis.__dmSql;
}

export type Tx = TransactionSql;

/** ログインユーザーの権限（RLS）で実行する */
export function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runAsUser(db(), userId, fn);
}
