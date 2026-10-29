import "server-only";
/**
 * ログインのセッション（Cookie）。
 *   Cookie：推測できないランダムな値（HttpOnly・SameSite=Lax・本番では Secure）
 *   DB（auth.sessions）：その SHA-256 と利用者・期限だけを保存する
 * セッションの確認は毎回 DB で行う（ログアウトや期限切れはすぐに効く）。
 * proxy.ts は Cookie の有無だけを見てログイン画面へ案内する（権限の確認は各画面・処理がサーバーで行う）。
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "dm_session";
/** 通常のログイン：30日 */
export const SESSION_TTL_MS = 30 * 24 * 3600_000;

/** Cookie の値の形（32バイトを base64url にしたもの）。形の違う値は DB に問い合わせない */
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** セッションを作って Cookie に入れる（既にあるこの端末のセッションは消す） */
export async function startSession(userId: string, ttlMs: number = SESSION_TTL_MS): Promise<void> {
  const store = await cookies();
  const previous = store.get(SESSION_COOKIE)?.value;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs);
  const sql = db();
  await sql.begin(async (tx) => {
    if (previous && SESSION_TOKEN_PATTERN.test(previous)) await tx`delete from auth.sessions where token_hash = ${hashToken(previous)}`;
    await tx`insert into auth.sessions (token_hash, user_id, expires_at) values (${hashToken(token)}, ${userId}, ${expiresAt})`;
  });
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Cookie のセッションが有効なら、その利用者 */
export async function readSession(): Promise<{ id: string; isAnonymous: boolean } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return null;
  const [row] = await db()<{ id: string; is_anonymous: boolean }[]>`
    select u.id, u.is_anonymous
      from auth.sessions s join auth.users u on u.id = s.user_id
     where s.token_hash = ${hashToken(token)} and s.expires_at > now()`;
  return row ? { id: row.id, isAnonymous: row.is_anonymous } : null;
}

/** ログアウト：DB のセッションを消し、Cookie も消す */
export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token && SESSION_TOKEN_PATTERN.test(token)) await db()`delete from auth.sessions where token_hash = ${hashToken(token)}`;
  store.delete(SESSION_COOKIE);
}

/**
 * 回数の制限。bucket ごとに、直近 windowMinutes 分の記録が max 件に達していたら false。
 * 記録するのは record() を呼んだときだけ（ログインは失敗したときだけ数える）。
 */
export async function underLimit(bucket: string, max: number, windowMinutes: number): Promise<boolean> {
  const [row] = await db()<{ n: number }[]>`
    select count(*)::int n from auth.rate_limits
     where bucket = ${bucket} and created_at > now() - make_interval(mins => ${windowMinutes})`;
  return row.n < max;
}

export async function record(bucket: string): Promise<void> {
  await db()`insert into auth.rate_limits (bucket) values (${bucket})`;
}
