/**
 * DB テスト：ドライバーの現在地（追加機能）。
 * 位置の送信・停止の権限、会社・本人ごとの見え方、操作履歴、地図に出す現在地（GPS・模擬位置）の組み立て。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { runAsUser } from "@/lib/db/rls";
import { getDriverPositions } from "@/lib/data/driver-positions";
import { listAuditLogs } from "@/lib/data/settings";
import { AUDIT_ACTION_LABEL, auditHref, describeAudit } from "@/lib/domain/audit";
import { toJstDate } from "@/lib/date";
import { connectTyped, createTenant, dropTenant, type TestTenant } from "./helpers";

let sql: Sql;
let a: TestTenant;
let b: TestTenant;
/** 模擬位置を確かめる時刻（直近の日本時間 11:00。データもこの時刻を基準に作る） */
let at: Date;

function latestJst11(now: Date): Date {
  const day = toJstDate(now);
  const t = new Date(`${day}T11:00:00+09:00`);
  return t.getTime() <= now.getTime() ? t : new Date(t.getTime() - 86_400_000);
}

beforeAll(async () => {
  sql = connectTyped();
  at = latestJst11(new Date());
  a = await createTenant(sql, { seed: 1818, now: at, isDemo: true });
  b = await createTenant(sql, { seed: 1919, now: at });
  // b は実在の会社と同じ扱い（模擬位置を出さない）
  await sql`update companies set simulate_locations = false where id = ${b.companyId}`;
});

afterAll(async () => {
  await dropTenant(sql, a);
  await dropTenant(sql, b);
  await sql.end();
});

const asAdmin = <T>(t: TestTenant, fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, t.adminId, fn);
const asDriver = <T>(t: TestTenant, fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, t.driverUserId, fn);

const report = (tx: TransactionSql, lat: number, lng: number, recordedAt: Date = new Date(), accuracy: number | null = 12) =>
  tx<{ saved_at: Date | null }[]>`
    select driver_report_location(${lat}, ${lng}, ${accuracy}, ${null}, ${null}, ${recordedAt}::timestamptz) saved_at`
    .then((rows) => rows[0].saved_at);
const stop = (tx: TransactionSql) =>
  tx<{ stopped: boolean }[]>`select driver_stop_location_sharing() stopped`.then((rows) => rows[0].stopped);

const shareLogs = (t: TestTenant) =>
  sql<{ action: string; actor_name: string; entity_id: string; detail: { driverName?: string } }[]>`
    select action, actor_name, entity_id, detail from audit_logs
     where company_id = ${t.companyId} and entity = 'driver_location' order by created_at, action`;

/** ログインしているドライバー以外の、在籍中のドライバー */
const otherDriver = (t: TestTenant) => ({ id: t.data.drivers.find((d) => d.id !== t.driverId && d.status === "active")!.id as string });

describe("位置の送信と停止", () => {
  it("ドライバー本人が送ると最新の1件を保存し、共有の開始を操作履歴に残す", async () => {
    const savedAt = await asDriver(a, (tx) => report(tx, 35.68, 139.76));
    expect(savedAt).toBeInstanceOf(Date);
    const rows = await sql<{ driver_id: string; company_id: string; lat: number; accuracy_m: number }[]>`
      select driver_id, company_id, lat, accuracy_m from driver_locations where company_id = ${a.companyId}`;
    expect(rows).toEqual([{ driver_id: a.driverId, company_id: a.companyId, lat: 35.68, accuracy_m: 12 }]);

    const logs = await shareLogs(a);
    expect(logs).toHaveLength(1);
    const driverName = a.data.drivers.find((d) => d.id === a.driverId)!.name;
    expect(logs[0]).toMatchObject({ action: "share_start", actor_name: "テストドライバー", entity_id: a.driverId });
    expect(logs[0].detail.driverName).toBe(driverName);
  });

  it("15秒以内の再送は保存しない。1分後の送信は位置を更新し、開始の記録は増やさない", async () => {
    expect(await asDriver(a, (tx) => report(tx, 35.69, 139.77))).toBeNull();
    const [kept] = await sql<{ lat: number }[]>`select lat from driver_locations where driver_id = ${a.driverId}`;
    expect(kept.lat).toBe(35.68);

    await sql`update driver_locations set updated_at = now() - interval '1 minute' where driver_id = ${a.driverId}`;
    expect(await asDriver(a, (tx) => report(tx, 35.7, 139.78))).toBeInstanceOf(Date);
    const [moved] = await sql<{ lat: number; lng: number }[]>`select lat, lng from driver_locations where driver_id = ${a.driverId}`;
    expect(moved).toEqual({ lat: 35.7, lng: 139.78 });
    expect((await shareLogs(a)).map((l) => l.action)).toEqual(["share_start"]);
  });

  it("範囲外の位置・古すぎる時刻・NaN は受け付けない", async () => {
    await expect(asDriver(a, (tx) => report(tx, 91, 139))).rejects.toThrow(/位置が正しくありません/);
    await expect(asDriver(a, (tx) => report(tx, 35, 181))).rejects.toThrow(/位置が正しくありません/);
    await expect(asDriver(a, (tx) => report(tx, Number.NaN, 139))).rejects.toThrow(/位置が正しくありません/);
    await expect(
      asDriver(a, (tx) => report(tx, 35, 139, new Date(Date.now() - 11 * 60_000))),
    ).rejects.toThrow(/古すぎます/);
    await sql`update driver_locations set updated_at = now() - interval '1 minute' where driver_id = ${a.driverId}`;
    await expect(asDriver(a, (tx) => report(tx, 35, 139, new Date(), Number.NaN))).rejects.toThrow(/check constraint/);
  });

  it("管理者は位置を送れない。表へ直接書き込むこともできない", async () => {
    await expect(asAdmin(a, (tx) => report(tx, 35.68, 139.76))).rejects.toThrow(/ドライバーだけ/);
    await expect(asAdmin(a, (tx) => stop(tx))).rejects.toThrow(/権限がありません/);
    const other = otherDriver(a);
    await expect(
      asDriver(a, (tx) => tx`insert into driver_locations (driver_id, company_id, lat, lng, recorded_at)
        values (${other.id}, ${a.companyId}, 35, 139, now())`),
    ).rejects.toThrow(/permission denied/);
    await expect(asDriver(a, (tx) => tx`update driver_locations set lat = 0`)).rejects.toThrow(/permission denied/);
    await expect(asAdmin(a, (tx) => tx`delete from driver_locations`)).rejects.toThrow(/permission denied/);
  });

  it("退職したドライバーは送れない", async () => {
    // b のドライバーのログインを、退職済みのドライバーに付け替えて確かめる
    const [retired] = await sql<{ id: string }[]>`
      insert into drivers (company_id, code, name, status) values (${b.companyId}, 'D-RETIRED', '退職 太郎', 'retired') returning id`;
    await sql`update profiles set driver_id = ${retired.id} where id = ${b.driverUserId}`;
    try {
      await expect(asDriver(b, (tx) => report(tx, 34.7, 135.5))).rejects.toThrow(/在籍中のドライバーだけ/);
    } finally {
      await sql`update profiles set driver_id = ${b.driverId} where id = ${b.driverUserId}`;
    }
  });

  it("停止すると位置を消して操作履歴に残す。共有していなければ何もしない", async () => {
    expect(await asDriver(a, (tx) => stop(tx))).toBe(true);
    expect(await sql`select 1 from driver_locations where driver_id = ${a.driverId}`).toHaveLength(0);
    expect(await asDriver(a, (tx) => stop(tx))).toBe(false);
    expect((await shareLogs(a)).map((l) => l.action)).toEqual(["share_start", "share_stop"]);
  });

  it("操作履歴の画面では「ドライバー・車両・荷主」に出て、ドライバーの詳細へリンクする", async () => {
    const { rows } = await asAdmin(a, (tx) => listAuditLogs(tx, { log: "masters", page: 1 }));
    const shares = rows.filter((r) => r.entity === "driver_location");
    expect(shares.map((r) => r.action).sort()).toEqual(["share_start", "share_stop"]);
    const driverName = a.data.drivers.find((d) => d.id === a.driverId)!.name;
    for (const r of shares) {
      expect(AUDIT_ACTION_LABEL[r.action]).toMatch(/位置情報の共有を(開始|停止)/);
      expect(describeAudit(r)).toBe(driverName);
      expect(auditHref(r)).toBe(`/drivers/${a.driverId}`);
    }
  });
});

describe("見える範囲", () => {
  beforeAll(async () => {
    const other = otherDriver(a);
    await sql`delete from driver_locations where company_id in ${sql([a.companyId, b.companyId])}`;
    await sql`insert into driver_locations (driver_id, company_id, lat, lng, recorded_at) values
      (${a.driverId}, ${a.companyId}, 35.6, 139.7, now()),
      (${other.id}, ${a.companyId}, 35.5, 139.6, now()),
      (${b.driverId}, ${b.companyId}, 34.7, 135.5, now())`;
  });

  it("管理者は自社のドライバー全員、ドライバーは自分の位置だけ見られる", async () => {
    const admin = await asAdmin(a, (tx) => tx<{ driver_id: string }[]>`select driver_id from driver_locations`);
    expect(admin.map((r) => r.driver_id).sort()).toEqual([a.driverId, otherDriver(a).id].sort());
    const driver = await asDriver(a, (tx) => tx<{ driver_id: string }[]>`select driver_id from driver_locations`);
    expect(driver.map((r) => r.driver_id)).toEqual([a.driverId]);
  });

  it("他社の管理者・ドライバーからは見えない", async () => {
    const admin = await asAdmin(b, (tx) => tx<{ driver_id: string }[]>`select driver_id from driver_locations`);
    expect(admin.map((r) => r.driver_id)).toEqual([b.driverId]);
    const driver = await asDriver(b, (tx) => tx`select 1 from driver_locations where company_id = ${a.companyId}`);
    expect(driver).toHaveLength(0);
  });
});

describe("地図に出す現在地", () => {
  beforeAll(async () => {
    await sql`delete from driver_locations where company_id in ${sql([a.companyId, b.companyId])}`;
  });

  it("模擬位置の会社では、本日の予定から求めた位置を、案件の状態と合う形で返す", async () => {
    const result = await asAdmin(a, (tx) => getDriverPositions(tx, at));
    expect(result.at).toBe(at.toISOString());
    const simulated = result.positions.filter((p) => p.source === "simulated");
    expect(simulated.length).toBeGreaterThan(0);

    const orders = await sql<{
      id: string; status: string; driver_id: string;
      pickup_lat: number; pickup_lng: number; delivery_lat: number; delivery_lng: number;
    }[]>`
      select id, status, driver_id, pickup_lat, pickup_lng, delivery_lat, delivery_lng
        from delivery_orders where company_id = ${a.companyId}`;
    const byId = new Map(orders.map((o) => [o.id, o]));
    for (const p of simulated) {
      expect(p.stale).toBe(false);
      expect(p.accuracyM).toBeNull();
      // 日本の範囲
      expect(p.lat).toBeGreaterThan(20);
      expect(p.lat).toBeLessThan(46);
      expect(p.lng).toBeGreaterThan(122);
      expect(p.lng).toBeLessThan(154);
      if (p.activity === "to_delivery") {
        const o = byId.get(p.order!.id)!;
        expect(o.driver_id).toBe(p.driverId);
        expect(["picked_up", "in_transit"]).toContain(o.status);
        // 集荷先と配送先のあいだ
        expect(p.lat).toBeGreaterThanOrEqual(Math.min(o.pickup_lat, o.delivery_lat) - 1e-6);
        expect(p.lat).toBeLessThanOrEqual(Math.max(o.pickup_lat, o.delivery_lat) + 1e-6);
        expect(p.lng).toBeGreaterThanOrEqual(Math.min(o.pickup_lng, o.delivery_lng) - 1e-6);
        expect(p.lng).toBeLessThanOrEqual(Math.max(o.pickup_lng, o.delivery_lng) + 1e-6);
      }
      if (p.activity === "to_pickup") {
        const o = byId.get(p.order!.id)!;
        expect(o.driver_id).toBe(p.driverId);
        expect(o.status).toBe("assigned");
      }
    }
  });

  it("共有中のドライバーは GPS の位置になり、更新が止まると「更新なし」、2時間を過ぎると GPS では出さない", async () => {
    const insert = (minutesAgo: number) => sql`
      insert into driver_locations (driver_id, company_id, lat, lng, accuracy_m, recorded_at, updated_at)
      values (${a.driverId}, ${a.companyId}, 35.6812, 139.7671, 8.4,
              ${new Date(at.getTime() - minutesAgo * 60_000)}, ${new Date(at.getTime() - minutesAgo * 60_000)})
      on conflict (driver_id) do update set updated_at = excluded.updated_at, recorded_at = excluded.recorded_at`;
    const mine = async () =>
      (await asAdmin(a, (tx) => getDriverPositions(tx, at))).positions.find((p) => p.driverId === a.driverId);

    await insert(3);
    expect(await mine()).toMatchObject({ source: "gps", lat: 35.6812, lng: 139.7671, accuracyM: 8, stale: false });

    await insert(30);
    expect(await mine()).toMatchObject({ source: "gps", stale: true });

    await insert(180);
    const old = await mine();
    expect(old?.source).not.toBe("gps");
  });

  it("模擬位置を使わない会社は、共有中のドライバーだけを返す", async () => {
    expect((await asAdmin(b, (tx) => getDriverPositions(tx, at))).positions).toEqual([]);
    await sql`insert into driver_locations (driver_id, company_id, lat, lng, recorded_at, updated_at)
      values (${b.driverId}, ${b.companyId}, 34.7, 135.5, ${at}, ${new Date(at.getTime() - 60_000)})`;
    const result = await asAdmin(b, (tx) => getDriverPositions(tx, at));
    expect(result.positions.map((p) => [p.driverId, p.source])).toEqual([[b.driverId, "gps"]]);
  });
});

describe("定期実行の片付け", () => {
  it("1日以上更新のない位置を消し、新しい位置は残す", async () => {
    await sql`delete from driver_locations where company_id in ${sql([a.companyId, b.companyId])}`;
    await sql`insert into driver_locations (driver_id, company_id, lat, lng, recorded_at, updated_at) values
      (${a.driverId}, ${a.companyId}, 35.6, 139.7, now(), now() - interval '2 days'),
      (${b.driverId}, ${b.companyId}, 34.7, 135.5, now(), now())`;
    await sql`select public.demo_cleanup()`;
    const left = await sql<{ driver_id: string }[]>`
      select driver_id from driver_locations where company_id in ${sql([a.companyId, b.companyId])}`;
    expect(left.map((r) => r.driver_id)).toEqual([b.driverId]);
  });
});
