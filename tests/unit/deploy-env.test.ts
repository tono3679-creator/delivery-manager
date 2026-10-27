import { describe, expect, it } from "vitest";
import { checkLoginPassword, checkSecretKey, checkSupabaseDbUrl } from "../../scripts/deploy/supabase-env";

const REF = "abcdefghijklmnopqrst";

describe("公開環境の接続情報の確認", () => {
  it("Session pooler の接続文字列から Supabase の URL を求める", () => {
    const r = checkSupabaseDbUrl(`postgresql://postgres.${REF}:p%40ss@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`);
    expect(r).toEqual({ ok: true, projectRef: REF, supabaseUrl: `https://${REF}.supabase.co` });
  });

  it.each([
    [undefined, "登録されていません"],
    ["not a url", "接続文字列"],
    [`https://${REF}.supabase.co`, "postgresql://"],
    [`postgresql://postgres.${REF}:[YOUR-PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`, "[YOUR-PASSWORD]"],
    [`postgresql://postgres:secret@db.${REF}.supabase.co:5432/postgres`, "IPv6"],
    [`postgresql://postgres.${REF}:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`, "Transaction pooler"],
    ["postgresql://postgres:secret@localhost:5432/postgres", "postgres.<プロジェクト ID>"],
  ])("使えない接続文字列は理由を返す（%s）", (value, message) => {
    const r = checkSupabaseDbUrl(value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });

  it("ログイン用パスワードは 8 文字以上で、README の既定値は使えない", () => {
    expect(checkLoginPassword(undefined)).toContain("登録されていません");
    expect(checkLoginPassword("short")).toContain("8 文字以上");
    expect(checkLoginPassword("demo-admin-2026")).toContain("既定のパスワード");
    expect(checkLoginPassword("a-long-enough-password")).toBeNull();
  });

  it("Secret key は sb_secret_ か従来の service_role キー（JWT）だけ受け付ける", () => {
    expect(checkSecretKey(undefined)).toContain("登録されていません");
    expect(checkSecretKey("sb_publishable_xxx")).toContain("Publishable key");
    expect(checkSecretKey("random")).toContain("形になっていません");
    expect(checkSecretKey("sb_secret_xxx")).toBeNull();
    expect(checkSecretKey("aaa.bbb.ccc")).toBeNull();
  });
});
