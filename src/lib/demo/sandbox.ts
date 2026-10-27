import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { DEFAULT_DEMO_SEED, generateDemoData } from "./generator";
import { loadDataset } from "./load";

export const DEMO_TTL_HOURS = 24;

/** デモ会社が上限まで作られているときのエラー（利用者向けの文言で知らせる） */
export class DemoCapacityError extends Error {
  constructor() {
    super("デモ環境の上限に達しています");
    this.name = "DemoCapacityError";
  }
}

/**
 * 新しいデモ会社を作れるか確かめる。上限に達していたら、まず期限切れのデモを片付けてから数え直す。
 * 公開デモでデータベースが際限なく大きくならないようにするため。
 */
export async function ensureDemoCapacity(): Promise<void> {
  const sql = db();
  const max = serverEnv.demoMaxActive;
  const count = async () => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int n from companies where is_demo and demo_expires_at > now()`;
    return row.n;
  };
  if ((await count()) < max) return;
  await sql`select demo_cleanup()`;
  if ((await count()) >= max) throw new DemoCapacityError();
}

/**
 * 訪問者専用のデモ会社を作る（既にあれば作り直す）。
 * デモデータは「今」を基準に生成するので、いつ開いても稼働中の配送会社に見える。
 */
export async function createDemoSandbox(userId: string, role: "admin" | "driver"): Promise<void> {
  const sql = db();
  const existing = await sql<{ company_id: string; is_demo: boolean }[]>`
    select p.company_id, c.is_demo from profiles p join companies c on c.id = p.company_id where p.id = ${userId}`;
  if (existing[0] && !existing[0].is_demo) throw new Error("デモ以外のアカウントでは利用できません");
  // 作り直し（同じ利用者のデモを置き換える）は数を増やさないので上限を確かめない
  if (!existing[0]) await ensureDemoCapacity();

  const companyId = randomUUID();
  const data = generateDemoData({
    seed: DEFAULT_DEMO_SEED,
    now: new Date(),
    companyId,
    isDemo: true,
    demoOwner: userId,
    demoExpiresAt: new Date(Date.now() + DEMO_TTL_HOURS * 3600_000),
  });
  const driverName = data.drivers.find((d) => d.id === data.featuredDriverId)?.name as string;

  await loadDataset(sql, data, async (tx) => {
    if (existing[0]) await tx`delete from companies where id = ${existing[0].company_id}`;
    await tx`
      insert into profiles (id, company_id, role, driver_id, display_name)
      values (${userId}, ${companyId}, ${role}, ${role === "driver" ? data.featuredDriverId : null},
              ${role === "driver" ? driverName : "デモ管理者"})`;
  });
}
