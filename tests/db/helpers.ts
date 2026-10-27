import postgres, { type Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { generateDemoData, type DemoDataset } from "@/lib/demo/generator";
import { loadDataset } from "@/lib/demo/load";
import { DB_TYPES } from "@/lib/db/types";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/dm";

export function connect(): Sql {
  return postgres(TEST_DATABASE_URL, { max: 4, prepare: false, onnotice: () => {} });
}

/** アプリと同じ型変換（numeric → number など）の接続。src/lib/data の関数をテストするときに使う */
export function connectTyped(): Sql {
  return postgres(TEST_DATABASE_URL, { max: 4, prepare: false, onnotice: () => {}, types: DB_TYPES });
}

export type TestTenant = {
  companyId: string;
  data: DemoDataset;
  adminId: string;
  driverUserId: string;
  driverId: string;
};

/** テスト用の会社を1社作り、管理者とドライバーのユーザーを用意する */
export async function createTenant(
  sql: Sql,
  options: { seed: number; now: Date; isDemo?: boolean },
): Promise<TestTenant> {
  const companyId = randomUUID();
  const adminId = randomUUID();
  const driverUserId = randomUUID();
  const data = generateDemoData({
    seed: options.seed,
    now: options.now,
    companyId,
    isDemo: options.isDemo ?? false,
    demoOwner: options.isDemo ? adminId : null,
    demoExpiresAt: options.isDemo ? new Date(Date.now() + 3600_000) : null,
  });
  await loadDataset(sql, data, async (tx) => {
    await tx`insert into auth.users (id, email, is_anonymous) values
      (${adminId}, ${`admin-${adminId}@test.example`}, false),
      (${driverUserId}, ${`driver-${driverUserId}@test.example`}, false)`;
    await tx`insert into public.profiles (id, company_id, role, driver_id, display_name) values
      (${adminId}, ${companyId}, 'admin', null, 'テスト管理者'),
      (${driverUserId}, ${companyId}, 'driver', ${data.featuredDriverId}, 'テストドライバー')`;
  });
  return { companyId, data, adminId, driverUserId, driverId: data.featuredDriverId };
}

export async function dropTenant(sql: Sql, tenant: TestTenant) {
  await sql`delete from public.companies where id = ${tenant.companyId}`;
  await sql`delete from auth.users where id in ${sql([tenant.adminId, tenant.driverUserId])}`;
}
