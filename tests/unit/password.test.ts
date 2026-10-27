/** パスワードの保存形式（scrypt）と照合 */
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("パスワード", () => {
  it("保存する値に元のパスワードは含まれず、同じパスワードでも毎回違う値になる（salt）", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(a).not.toContain("correct");
    expect(a).not.toBe(b);
  });

  it("正しいパスワードだけ一致する", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("全角・半角の違いは同じ文字として扱う（NFKC）", async () => {
    const stored = await hashPassword("Ｐａｓｓ１２３");
    expect(await verifyPassword("Pass123", stored)).toBe(true);
  });

  it("保存した値がない・壊れている・強さが極端な値は、常に不一致", async () => {
    const stored = await hashPassword("pw-123456");
    const [, , r, p, salt, hash] = stored.split("$");
    expect(await verifyPassword("pw-123456", null)).toBe(false);
    expect(await verifyPassword("pw-123456", undefined)).toBe(false);
    expect(await verifyPassword("pw-123456", "bcrypt$xxx")).toBe(false);
    expect(await verifyPassword("pw-123456", ["scrypt", 2 ** 10, r, p, salt, hash].join("$"))).toBe(false);
    expect(await verifyPassword("pw-123456", ["scrypt", 2 ** 24, r, p, salt, hash].join("$"))).toBe(false);
    expect(await verifyPassword("pw-123456", ["scrypt", 2 ** 15, r, p, salt, hash.slice(0, 20)].join("$"))).toBe(false);
  });
});
