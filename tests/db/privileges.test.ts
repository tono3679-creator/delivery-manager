/**
 * DB テスト：表・関数の権限（Phase 5）。
 * Supabase は public スキーマの表・関数に全権限を既定で付けるため（ローカルのシムでも同じ状態を再現している）、
 * マイグレーションで「アプリが使う権限だけ」に締め直せていることを確かめる。
 * データ API（PostgREST）からログイン中のトークンで直接呼ばれても、ここに書いた以上のことはできない。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { runAsUser } from "@/lib/db/rls";
import { connect, createTenant, dropTenant, type TestTenant } from "./helpers";

let sql: Sql;
let a: TestTenant;
let b: TestTenant;

beforeAll(async () => {
  sql = connect();
  const now = new Date();
  a = await createTenant(sql, { seed: 1414, now, isDemo: true });
  b = await createTenant(sql, { seed: 1515, now });
});

afterAll(async () => {
  await dropTenant(sql, a);
  await dropTenant(sql, b);
  await sql.end();
});

const asAdminA = <T>(fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, a.adminId, fn);
const asDriverA = <T>(fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, a.driverUserId, fn);
const asAnon = <T>(fn: (tx: TransactionSql) => Promise<T>) =>
  sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('role', 'anon', true)`;
    return fn(tx);
  }) as Promise<T>;

/** ログイン中の利用者（authenticated）が持ってよい表の権限 */
const EXPECTED_TABLE_PRIVILEGES: Record<string, string[]> = {
  audit_logs: ["INSERT", "SELECT"],
  client_invoices: ["SELECT"],
  clients: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  companies: ["SELECT"],
  delivery_notes: ["INSERT", "SELECT"],
  delivery_orders: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  delivery_status_logs: ["SELECT"],
  driver_locations: ["SELECT"],
  drivers: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  expenses: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  notifications: ["SELECT"],
  offices: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  profiles: ["SELECT"],
  v_order_facts: ["SELECT"],
  vehicle_assignments: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  vehicles: ["DELETE", "INSERT", "SELECT", "UPDATE"],
};

/** 列単位で更新できるもの（表全体の UPDATE は持たない） */
const EXPECTED_COLUMN_UPDATES = ["client_invoices.notes", "companies.name", "notifications.read_at"];

const EXPECTED_FUNCTIONS = [
  "admin_update_status", "analytics_by_client", "analytics_by_driver", "analytics_expense_breakdown",
  "analytics_order_series", "analytics_series", "analytics_summary", "can_transition", "cancel_client_invoice",
  "dashboard_kpis", "demo_switch_role", "driver_report_location", "driver_stop_location_sharing", "driver_update_status",
  "issue_client_invoice", "refresh_late_alerts",
];

describe("表・関数の権限", () => {
  it("ログイン中の利用者の表の権限は、アプリが使うものだけ（TRUNCATE・REFERENCES・TRIGGER は持たない）", async () => {
    const rows = await sql<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'authenticated' and table_schema = 'public'
       order by table_name, privilege_type`;
    const actual: Record<string, string[]> = {};
    for (const r of rows) (actual[r.table_name] ??= []).push(r.privilege_type);
    expect(actual).toEqual(EXPECTED_TABLE_PRIVILEGES);

    const cols = await sql<{ col: string }[]>`
      select c.relname || '.' || a.attname col
        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and a.attnum > 0 and a.attacl is not null
         and has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
         and not has_table_privilege('authenticated', c.oid, 'UPDATE')
       order by 1`;
    expect(cols.map((c) => c.col)).toEqual(EXPECTED_COLUMN_UPDATES);
  });

  it("ログインしていない訪問者（anon）は public スキーマの表・関数を何も使えない", async () => {
    const [{ tables }] = await sql<{ tables: number }[]>`
      select count(*)::int tables from information_schema.role_table_grants
       where grantee in ('anon', 'PUBLIC') and table_schema = 'public'`;
    expect(tables).toBe(0);
    const [{ columns }] = await sql<{ columns: number }[]>`
      select count(*)::int columns from information_schema.column_privileges
       where grantee in ('anon', 'PUBLIC') and table_schema = 'public'`;
    expect(columns).toBe(0);
    const fns = await sql<{ name: string }[]>`
      select p.proname name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`;
    expect(fns).toEqual([]);

    await expect(asAnon((tx) => tx`select count(*) from delivery_orders`)).rejects.toThrow(/permission denied/);
    await expect(asAnon((tx) => tx`select dashboard_kpis(current_date)`)).rejects.toThrow(/permission denied/);
  });

  it("ログイン中の利用者が呼べる関数は決まったものだけ（デモの一括削除は呼べない）", async () => {
    const fns = await sql<{ name: string }[]>`
      select p.proname name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
       order by 1`;
    expect(fns.map((f) => f.name)).toEqual(EXPECTED_FUNCTIONS);
    await expect(asAdminA((tx) => tx`select demo_cleanup()`)).rejects.toThrow(/permission denied/);
  });

  it("TRUNCATE（RLS が効かない一括削除）はできない", async () => {
    await expect(asAdminA((tx) => tx`truncate delivery_orders cascade`)).rejects.toThrow(/permission denied/);
    await expect(asAdminA((tx) => tx`truncate notifications`)).rejects.toThrow(/permission denied/);
  });

  it("これから追加する表・関数にも、自動では権限が付かない", async () => {
    const rows = await sql<{ type: string; acl: string }[]>`
      select d.defaclobjtype type, array_to_string(d.defaclacl, ',') acl
        from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
       where n.nspname = 'public' and d.defaclrole = current_user::regrole`;
    for (const r of rows) {
      expect(r.acl).not.toMatch(/(^|,)(anon|authenticated)=/);
      expect(r.acl).not.toMatch(/(^|,)=/); // PUBLIC
    }
  });
});

describe("会社の情報", () => {
  it("管理者は自社の会社名だけ変更でき、デモの期限・所有者・連番・模擬位置の設定は変更できない", async () => {
    const before = await sql<{ name: string; demo_expires_at: Date }[]>`
      select name, demo_expires_at from companies where id = ${a.companyId}`;
    const updated = await asAdminA((tx) => tx`update companies set name = 'テスト運送' where id = ${a.companyId} returning id`);
    expect(updated).toHaveLength(1);

    for (const column of ["demo_expires_at", "is_demo", "demo_owner", "order_seq", "simulate_locations"] as const) {
      const value = column === "demo_expires_at" ? sql`now() + interval '100 years'`
        : column === "is_demo" || column === "simulate_locations" ? sql`false`
        : column === "demo_owner" ? sql`null`
        : sql`0`;
      await expect(
        asAdminA((tx) => tx`update companies set ${tx(column)} = ${value} where id = ${a.companyId}`),
      ).rejects.toThrow(/permission denied/);
    }
    const [after] = await sql<{ name: string; is_demo: boolean; demo_expires_at: Date }[]>`
      select name, is_demo, demo_expires_at from companies where id = ${a.companyId}`;
    expect(after).toMatchObject({ name: "テスト運送", is_demo: true });
    expect(after.demo_expires_at.getTime()).toBe(before[0].demo_expires_at.getTime());
  });

  it("ドライバーと他社の管理者は会社名を変更できない", async () => {
    const byDriver = await asDriverA((tx) => tx`update companies set name = 'ドライバーが変更' where id = ${a.companyId} returning id`);
    expect(byDriver).toHaveLength(0);
    const otherCompany = await asAdminA((tx) => tx`update companies set name = '他社から変更' where id = ${b.companyId} returning id`);
    expect(otherCompany).toHaveLength(0);
    await expect(asAdminA((tx) => tx`insert into companies (name) values ('勝手に作る会社')`)).rejects.toThrow(/permission denied/);
    await expect(asAdminA((tx) => tx`delete from companies where id = ${a.companyId}`)).rejects.toThrow(/permission denied/);
  });

  it("自分のロールや所属会社は書き換えられない", async () => {
    await expect(
      asDriverA((tx) => tx`update profiles set role = 'admin' where id = ${a.driverUserId}`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAdminA((tx) => tx`update profiles set company_id = ${b.companyId} where id = ${a.adminId}`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("書いた人の記録", () => {
  it("配送メモの書き手と日時は、送られた値ではなくログイン中の利用者と現在時刻になる", async () => {
    const [order] = await sql<{ id: string }[]>`
      select id from delivery_orders where company_id = ${a.companyId} and driver_id = ${a.driverId} limit 1`;
    const [note] = await asDriverA((tx) => tx<{ author_id: string; author_name: string; created_at: Date }[]>`
      insert into delivery_notes (company_id, order_id, author_id, author_name, body, created_at)
      values (${a.companyId}, ${order.id}, ${a.driverUserId}, '別の人の名前', 'なりすましの確認', '2020-01-01')
      returning author_id, author_name, created_at`);
    expect(note.author_id).toBe(a.driverUserId);
    expect(note.author_name).toBe("テストドライバー");
    expect(Date.now() - note.created_at.getTime()).toBeLessThan(60_000);
  });

  it("操作履歴の実行者と日時も、ログイン中の利用者と現在時刻になる", async () => {
    const [log] = await asAdminA((tx) => tx<{ actor_name: string; created_at: Date }[]>`
      insert into audit_logs (company_id, actor_id, actor_name, action, entity, created_at)
      values (${a.companyId}, ${a.adminId}, '別の人の名前', 'update', 'company', '2020-01-01')
      returning actor_name, created_at`);
    expect(log.actor_name).toBe("テスト管理者");
    expect(Date.now() - log.created_at.getTime()).toBeLessThan(60_000);
    // 他人の ID を指定しても、ログイン中の利用者の記録になる
    const [other] = await asAdminA((tx) => tx<{ actor_id: string }[]>`
      insert into audit_logs (company_id, actor_id, action, entity)
      values (${a.companyId}, ${a.driverUserId}, 'update', 'company') returning actor_id`);
    expect(other.actor_id).toBe(a.adminId);
    // 他社の操作履歴には書けない
    await expect(
      asAdminA((tx) => tx`insert into audit_logs (company_id, action, entity) values (${b.companyId}, 'update', 'company')`),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("デモ環境の上限", () => {
  it("上限に達したら期限切れのデモを片付けてから数え直し、それでも多ければ断る", async () => {
    process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/dm";
    const { ensureDemoCapacity, DemoCapacityError } = await import("@/lib/demo/sandbox");
    const [{ n: active }] = await sql<{ n: number }[]>`
      select count(*)::int n from companies where is_demo and demo_expires_at > now()`;
    expect(active).toBeGreaterThanOrEqual(1); // a はデモ会社

    // 期限切れのデモ会社を1社用意する
    const [expired] = await sql<{ id: string }[]>`
      insert into companies (name, is_demo, demo_expires_at) values ('期限切れデモ', true, now() - interval '1 hour') returning id`;
    try {
      process.env.DEMO_MAX_ACTIVE = String(active + 1);
      await expect(ensureDemoCapacity()).resolves.toBeUndefined();
      // 期限切れは数えない（まだ片付けない）
      expect(await sql`select 1 from companies where id = ${expired.id}`).toHaveLength(1);

      process.env.DEMO_MAX_ACTIVE = String(active);
      await expect(ensureDemoCapacity()).rejects.toBeInstanceOf(DemoCapacityError);
      // 断る前に期限切れのデモは片付けている
      expect(await sql`select 1 from companies where id = ${expired.id}`).toHaveLength(0);
    } finally {
      delete process.env.DEMO_MAX_ACTIVE;
      await sql`delete from companies where id = ${expired.id}`;
      await globalThis.__dmSql?.end();
      globalThis.__dmSql = undefined;
    }
  });
});
