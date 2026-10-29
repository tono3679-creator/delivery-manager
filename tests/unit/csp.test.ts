/** CSP（Content Security Policy）の組み立て */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("@/lib/security/csp");
}

describe("buildCsp", () => {
  it("スクリプトは nonce 付きのものだけ。本番では eval を許可しない", async () => {
    const { buildCsp } = await load({});
    const csp = buildCsp("NONCE", { dev: false });
    expect(csp).toContain("script-src 'self' 'nonce-NONCE' 'strict-dynamic';");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(buildCsp("N", { dev: true })).toContain("'unsafe-eval'");
  });

  it("通信先は自分のサイトだけ、画像は地図タイルの配信元だけ", async () => {
    const { buildCsp } = await load({ NEXT_PUBLIC_MAP_TILE_URL: "https://{s}.tiles.example.com/{z}/{x}/{y}.png?key=xyz" });
    const csp = buildCsp("N", { dev: false });
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("img-src 'self' data: blob: https://*.tiles.example.com;");
  });

  it("設定が空でも壊れた値を出さない", async () => {
    const { buildCsp } = await load({ NEXT_PUBLIC_MAP_TILE_URL: "" });
    const csp = buildCsp("N", { dev: false });
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("img-src 'self' data: blob: https://tile.openstreetmap.org;");
    expect(createNonceLength(await import("@/lib/security/csp"))).toBeGreaterThanOrEqual(22);
  });
});

function createNonceLength(mod: typeof import("@/lib/security/csp")) {
  const a = mod.createNonce();
  expect(a).not.toBe(mod.createNonce());
  return a.length;
}
