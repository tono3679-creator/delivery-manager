/**
 * DB テスト：アプリ内のログイン（セッション・回数の記録・ログイン用アカウント）とマイグレーション。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { runAsUser } from "@/lib/db/rls";
import { verifyPassword } from "@/lib/password";
import { createLoginUser } from "../../scripts/seed/users";
import { migrate } from "../../scripts/db/migrate";
import { connect } from "./helpers";

let sql: Sql;
const created: string[] = [];

beforeAll(() => {
  sql = connect();
});

afterAll(async () => {
  if (created.length > 0) await sql`delete from auth.users where id = any(${created})`;
  await sql`delete from auth.rate_limits where bucket like 'test:%'`;
  await sql.end();
});

async function anonymousUser(createdAt = "now()"): Promise<string> {
  const [row] = await sql.unsafe<{ id: string }[]>(
    `insert into auth.users (is_anonymous, created_at) values (true, ${createdAt}) returning id`,
  );
  created.push(row.id);
  return row.id;
}

describe("ログインの情報は、ログイン中の利用者の権限からは見えない", () => {
  it.each(["auth.users", "auth.sessions", "auth.rate_limits"])("%s は読めない", async (table) => {
    const userId = await anonymousUser();
    await expect(runAsUser(sql, userId, (tx) => tx.unsafe(`select 1 from ${table} limit 1`))).rejects.toThrow(/permission denied/);
  });

  it("セッションを書き込むこともできない", async () => {
    const userId = await anonymousUser();
    await expect(
      runAsUser(sql, userId, (tx) => tx`insert into auth.sessions (token_hash, user_id, expires_at) values ('x', ${userId}, now() + interval '1 day')`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("定期実行（demo_cleanup）での片付け", () => {
  it("期限切れのセッション・1日より前の回数の記録・会社のない古い匿名ユーザーを消し、有効なものは残す", async () => {
    const live = await anonymousUser();
    const stale = await anonymousUser("now() - interval '2 days'");
    await sql`insert into auth.sessions (token_hash, user_id, expires_at) values
      (${`test-live-${live}`}, ${live}, now() + interval '1 day'),
      (${`test-expired-${live}`}, ${live}, now() - interval '1 minute')`;
    await sql`insert into auth.rate_limits (bucket, created_at) values
      ('test:recent', now()), ('test:old', now() - interval '2 days')`;

    await sql`select demo_cleanup()`;

    const sessions = await sql<{ token_hash: string }[]>`select token_hash from auth.sessions where user_id = ${live}`;
    expect(sessions.map((s) => s.token_hash)).toEqual([`test-live-${live}`]);
    const buckets = await sql<{ bucket: string }[]>`select bucket from auth.rate_limits where bucket like 'test:%'`;
    expect(buckets.map((b) => b.bucket)).toEqual(["test:recent"]);
    const users = await sql<{ id: string }[]>`select id from auth.users where id in (${live}, ${stale})`;
    expect(users.map((u) => u.id)).toEqual([live]);
  });

  it("利用者を消すと、その利用者のセッションも消える", async () => {
    const userId = await anonymousUser();
    await sql`insert into auth.sessions (token_hash, user_id, expires_at) values (${`test-${userId}`}, ${userId}, now() + interval '1 day')`;
    await sql`delete from auth.users where id = ${userId}`;
    const [row] = await sql<{ n: number }[]>`select count(*)::int n from auth.sessions where user_id = ${userId}`;
    expect(row.n).toBe(0);
  });
});

describe("ログイン用アカウントの作成（Seed）", () => {
  const email = () => `Test-${randomUUID().slice(0, 8)}@Example.com`;

  it("パスワードは scrypt で保存し、メールアドレスは小文字にそろえる", async () => {
    const address = email();
    const id = await createLoginUser(sql, { email: address, password: "first-passphrase" });
    created.push(id);
    const [user] = await sql<{ email: string; encrypted_password: string; is_anonymous: boolean }[]>`
      select email, encrypted_password, is_anonymous from auth.users where id = ${id}`;
    expect(user.email).toBe(address.toLowerCase());
    expect(user.is_anonymous).toBe(false);
    expect(user.encrypted_password).toMatch(/^scrypt\$/);
    expect(await verifyPassword("first-passphrase", user.encrypted_password)).toBe(true);
  });

  it("同じパスワードで再実行してもログイン中の端末はそのまま。パスワードを変えるとログアウトさせる", async () => {
    const address = email();
    const id = await createLoginUser(sql, { email: address, password: "first-passphrase" });
    created.push(id);
    await sql`insert into auth.sessions (token_hash, user_id, expires_at) values (${`test-${id}`}, ${id}, now() + interval '1 day')`;
    const count = async () => (await sql<{ n: number }[]>`select count(*)::int n from auth.sessions where user_id = ${id}`)[0].n;

    // 大文字・小文字の違うメールアドレスでも同じ利用者
    expect(await createLoginUser(sql, { email: address.toUpperCase(), password: "first-passphrase" })).toBe(id);
    expect(await count()).toBe(1);

    expect(await createLoginUser(sql, { email: address, password: "second-passphrase" })).toBe(id);
    expect(await count()).toBe(0);
    const [user] = await sql<{ encrypted_password: string }[]>`select encrypted_password from auth.users where id = ${id}`;
    expect(await verifyPassword("second-passphrase", user.encrypted_password)).toBe(true);
    expect(await verifyPassword("first-passphrase", user.encrypted_password)).toBe(false);
  });

  it("メールアドレスは大文字・小文字を区別せず重複できない", async () => {
    const address = email();
    created.push(await createLoginUser(sql, { email: address, password: "first-passphrase" }));
    await expect(sql`insert into auth.users (email) values (${address.toUpperCase()})`).rejects.toThrow(/duplicate key/);
  });
});

describe("マイグレーション", () => {
  it("適用済みのものは飛ばす（何度実行しても同じ状態）", async () => {
    const lines: string[] = [];
    expect(await migrate(sql, (line) => lines.push(line))).toEqual([]);
    expect(lines).toEqual(["マイグレーション：新しいものはありません"]);
    const [row] = await sql<{ n: number }[]>`select count(*)::int n from app_meta.migrations`;
    expect(row.n).toBeGreaterThanOrEqual(15);
    // 最初の準備（db/bootstrap.sql）は再実行しないので、締め直した既定の権限が戻らない
    const acl = await sql<{ acl: string }[]>`
      select d.defaclacl::text acl from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
       where n.nspname = 'public' and d.defaclrole = current_user::regrole`;
    for (const r of acl) expect(r.acl).not.toMatch(/(^|[,{])(anon|authenticated)=/);
  });
});
