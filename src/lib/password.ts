/**
 * パスワードの保存形式（scrypt）。Node.js の標準機能だけで作り、外部のライブラリは使わない。
 *   保存する値：scrypt$<N>$<r>$<p>$<salt(base64url)>$<hash(base64url)>
 * 照合は一定時間の比較で行う。Seed（scripts/seed/users.ts）とアプリの両方から使う。
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
// N=2^15・r=8 は 32MB を使う。Node.js の既定の上限（32MB）ちょうどなので余裕を持たせる
const MAX_MEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, { N, r: R, p: P, maxmem: MAX_MEM });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** 保存した値と照合する。形式が違う・壊れている値は常に不一致 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    // 利用者がいない場合も同じだけ時間をかける（登録の有無を応答時間から推測されないように）
    await scrypt(password, randomBytes(16), { N, r: R, p: P, maxmem: MAX_MEM });
    return false;
  }
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64url");
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(cost.N) || cost.N > 2 ** 20 || cost.N < 2 ** 14 || expected.length !== KEY_LENGTH) return false;
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), { ...cost, maxmem: MAX_MEM * 4 });
  return timingSafeEqual(actual, expected);
}
