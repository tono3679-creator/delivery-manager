import { describe, expect, it } from "vitest";
import { checkProductionEnv } from "../../scripts/deploy/production-env";
import { checkLoginPassword, isLocalDatabase, seedPasswords } from "../../scripts/seed/users";

const NEON = "postgresql://neondb_owner:secret@ep-cool-name-a1b2c3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const NEON_UNPOOLED = NEON.replace("-pooler", "");
const OK_ENV = {
  DATABASE_URL: NEON,
  DATABASE_URL_UNPOOLED: NEON_UNPOOLED,
  SEED_LOGIN_PASSWORD: "a-long-enough-passphrase",
  CRON_SECRET: "0123456789abcdef0123",
};

describe("公開環境（Vercel）の環境変数の確認", () => {
  it("Neon の接続文字列・パスワード・CRON_SECRET がそろっていれば問題なし", () => {
    expect(checkProductionEnv(OK_ENV)).toEqual([]);
  });

  it("足りないものを、何をすればよいかと一緒にすべて挙げる", () => {
    const errors = checkProductionEnv({});
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("Storage から Neon を追加");
    expect(errors[1]).toContain("SEED_LOGIN_PASSWORD が設定されていません");
    expect(errors[2]).toContain("CRON_SECRET を設定してください");
  });

  it.each([
    [{ DATABASE_URL: "not a url" }, "接続文字列"],
    [{ DATABASE_URL: "https://example.com" }, "postgresql://"],
    [{ DATABASE_URL: "postgres://postgres:postgres@localhost:5432/dm" }, "localhost"],
    [{ DATABASE_URL_UNPOOLED: "mysql://x@y/z" }, "DATABASE_URL_UNPOOLED は postgresql://"],
    [{ SEED_LOGIN_PASSWORD: "short-pass" }, "12 文字以上"],
    [{ SEED_LOGIN_PASSWORD: "demo-admin-2026" }, "既定のパスワード"],
    [{ SEED_ADMIN_PASSWORD: "demo-driver-2026" }, "SEED_ADMIN_PASSWORD に README"],
    [{ CRON_SECRET: "short" }, "CRON_SECRET は 16 文字以上"],
  ])("使えない値は理由を返す（%o）", (override, message) => {
    const errors = checkProductionEnv({ ...OK_ENV, ...override });
    expect(errors.join("\n")).toContain(message);
  });
});

describe("見本の会社のログイン用パスワード", () => {
  it("自分の PC の DB なら、未設定のとき README の既定値を使う", () => {
    expect(isLocalDatabase("postgres://postgres:postgres@localhost:5432/dm")).toBe(true);
    expect(isLocalDatabase("postgres://u:p@127.0.0.1/dm")).toBe(true);
    expect(isLocalDatabase(NEON)).toBe(false);
    expect(isLocalDatabase("not a url")).toBe(false);
    expect(seedPasswords({}, "postgres://postgres:postgres@localhost:5432/dm")).toEqual({
      admin: "demo-admin-2026",
      driver: "demo-driver-2026",
    });
  });

  it("公開環境では既定値を使わない。SEED_LOGIN_PASSWORD を両方に使い、個別の指定があれば優先する", () => {
    expect(() => seedPasswords({}, NEON)).toThrow(/SEED_LOGIN_PASSWORD が設定されていません/);
    expect(seedPasswords({ SEED_LOGIN_PASSWORD: "shared-passphrase-1" }, NEON)).toEqual({
      admin: "shared-passphrase-1",
      driver: "shared-passphrase-1",
    });
    expect(seedPasswords({ SEED_LOGIN_PASSWORD: "shared-passphrase-1", SEED_DRIVER_PASSWORD: "driver-passphrase-2" }, NEON)).toEqual({
      admin: "shared-passphrase-1",
      driver: "driver-passphrase-2",
    });
  });

  it("README に載っている既定のパスワードは、長さが足りていても使えない", () => {
    expect(checkLoginPassword("X", undefined)).toContain("設定されていません");
    expect(checkLoginPassword("X", "short")).toContain("12 文字以上");
    expect(checkLoginPassword("X", "demo-admin-2026")).toContain("既定のパスワード");
    expect(checkLoginPassword("X", "a-long-enough-passphrase")).toBeNull();
  });
});
