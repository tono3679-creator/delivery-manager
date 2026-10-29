import { describe, expect, it } from "vitest";
import { toPostgresJsUrl } from "@/lib/db/url";

describe("接続文字列を postgres.js 向けに整える（toPostgresJsUrl）", () => {
  it("Neon の接続文字列から channel_binding だけを外し、sslmode などは残す", () => {
    const url = "postgresql://user:p%40ss@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    const fixed = new URL(toPostgresJsUrl(url));
    expect(fixed.searchParams.has("channel_binding")).toBe(false);
    expect(fixed.searchParams.get("sslmode")).toBe("require");
    expect(fixed.username).toBe("user");
    expect(fixed.password).toBe("p%40ss");
    expect(fixed.host).toBe("ep-x-pooler.ap-southeast-1.aws.neon.tech");
    expect(fixed.pathname).toBe("/neondb");
  });

  it("channel_binding がなければそのまま返す", () => {
    const url = "postgres://postgres:postgres@localhost:5432/dm?sslmode=disable";
    expect(toPostgresJsUrl(url)).toBe(url);
  });

  it("URL として読めない文字列はそのまま返す（接続時のエラーに任せる）", () => {
    expect(toPostgresJsUrl("not a url")).toBe("not a url");
  });
});
