/** アプリ側の業務ルールと DB 側の定義が一致しているか、デモデータが整合しているかを確認する */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { ORDER_STATUSES, canTransition } from "@/lib/domain/status";
import { generateDemoData } from "@/lib/demo/generator";
import { INTEGRITY_CHECKS } from "../../scripts/seed/checks";
import { connect, createTenant, dropTenant, type TestTenant } from "./helpers";

let sql: Sql;
let tenant: TestTenant;

beforeAll(async () => {
  sql = connect();
  tenant = await createTenant(sql, { seed: 303, now: new Date() });
});

afterAll(async () => {
  await dropTenant(sql, tenant);
  await sql.end();
});

describe("ステータス遷移の定義", () => {
  it("TypeScript と DB の can_transition() が全組み合わせで一致する", async () => {
    const rows = await sql<{ f: string; t: string; ok: boolean }[]>`
      select f::text, t::text, can_transition(f, t) ok
        from unnest(enum_range(null::order_status)) f, unnest(enum_range(null::order_status)) t`;
    expect(rows.length).toBe(ORDER_STATUSES.length ** 2);
    for (const r of rows) {
      expect([r.f, r.t, canTransition(r.f as never, r.t as never)]).toEqual([r.f, r.t, r.ok]);
    }
  });
});

describe("デモデータ", () => {
  it("同じ Seed 値と基準時刻なら同じ内容になる", () => {
    const now = new Date("2026-10-27T02:00:00Z");
    const x = generateDemoData({ seed: 7, now, companyId: "00000000-0000-4000-8000-000000000001", isDemo: false });
    const y = generateDemoData({ seed: 7, now, companyId: "00000000-0000-4000-8000-000000000001", isDemo: false });
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
    const z = generateDemoData({ seed: 8, now, companyId: "00000000-0000-4000-8000-000000000001", isDemo: false });
    expect(JSON.stringify(z.orders)).not.toBe(JSON.stringify(x.orders));
  });

  it("規模：ドライバー15名・車両18台・荷主12社・直近3か月で約3,000件", () => {
    const d = tenant.data;
    expect(d.drivers.length).toBe(15);
    expect(d.vehicles.length).toBe(18);
    expect(d.clients.length).toBe(12);
    const now = Date.now();
    const recent = d.orders.filter((o) => {
      const t = (o.delivery_at as Date).getTime();
      return t <= now + 86400_000 && t >= now - 91 * 86400_000;
    });
    expect(recent.length).toBeGreaterThan(2700);
    expect(recent.length).toBeLessThan(3400);
  });

  for (const check of INTEGRITY_CHECKS) {
    it(`整合性：${check.label}`, async () => {
      // DB 全体（シード済みの会社とテスト用の会社）を対象に確認する
      const [row] = await sql.unsafe<{ n: string }[]>(check.sql);
      expect(Number(row.n)).toBe(0);
    });
  }
});
