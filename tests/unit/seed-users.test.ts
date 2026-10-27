import type { Sql } from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoginUser } from "../../scripts/seed/users";

/** auth.users の検索結果だけを返す偽の DB 接続 */
function fakeSql(rows: { id: string }[]): Sql {
  return (async () => rows) as unknown as Sql;
}

describe("公開環境でのログイン用アカウントの作成（Supabase Auth の管理 API）", () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "user-1" }), { status: 200 }));

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockClear();
  });

  it("新しい Secret key は apikey ヘッダーだけで送る（JWT ではないため）", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abc");
    const id = await createLoginUser(fakeSql([]), { email: "a@example.com", password: "long-password" });
    expect(id).toBe("user-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://abcdefghijklmnopqrst.supabase.co/auth/v1/admin/users");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ apikey: "sb_secret_abc", "Content-Type": "application/json" });
  });

  it("従来の service_role キーは Authorization にも付ける。既にいるユーザーはパスワードを更新する", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "aaa.bbb.ccc");
    await createLoginUser(fakeSql([{ id: "existing" }]), { email: "a@example.com", password: "new-password" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://abcdefghijklmnopqrst.supabase.co/auth/v1/admin/users/existing");
    expect(init.method).toBe("PUT");
    expect(init.headers).toMatchObject({ apikey: "aaa.bbb.ccc", Authorization: "Bearer aaa.bbb.ccc" });
    expect(JSON.parse(init.body as string)).toMatchObject({ password: "new-password" });
  });

  it("失敗したら、どのアカウントで失敗したかを伝える", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abc");
    fetchMock.mockResolvedValueOnce(new Response("Password should be at least 6 characters", { status: 422 }));
    await expect(createLoginUser(fakeSql([]), { email: "a@example.com", password: "x" })).rejects.toThrow(/a@example\.com.*422/);
  });
});
