/**
 * DB テスト：CSV 入出力。
 *   1. 取り込み：自社のマスタだけと照合し、エラー（登録不可）と注意（確認すれば登録可）を正しく分ける
 *   2. 登録は全件か0件か（途中で DB のルールに反する行があれば1件も残らない）。案件番号・ステータス・通知は手入力と同じ
 *   3. 書き出し：一覧と同じ条件・件数で、自社の案件だけ。書き出した CSV はそのまま読み込める
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { runAsUser } from "@/lib/db/rls";
import { decodeCsvBytes, parseCsv, toCsv } from "@/lib/csv/csv";
import { formatCsvDateTime, ORDER_EXPORT_HEADER, ORDER_IMPORT_HEADER, readImportRows } from "@/lib/csv/orders";
import { insertImportedOrders, validateImportRows } from "@/lib/data/order-import";
import { exportOrders, listOrders, parseOrderFilters } from "@/lib/data/orders";
import { addDays, todayJst } from "@/lib/date";
import { ORDER_STATUS_LABEL } from "@/lib/domain/status";
import { connectTyped, createTenant, dropTenant, type TestTenant } from "./helpers";

let sql: Sql;
let a: TestTenant;
let b: TestTenant;
const now = new Date();
const today = todayJst(now);
/** 2日後（「予定時刻を過ぎている」の注意が出ない日） */
const day = addDays(today, 2);
const slash = day.replaceAll("-", "/");

type Col = (typeof ORDER_IMPORT_HEADER)[number];
type Ctx = {
  client: { id: string; code: string; name: string; address: string };
  driver: { id: string; code: string; name: string; vehicle_id: string };
  leaveDriver: { code: string } | undefined;
  maintenanceVehicle: { plate_number: string } | undefined;
};
let ctx: Ctx;

beforeAll(async () => {
  sql = connectTyped();
  a = await createTenant(sql, { seed: 909, now });
  b = await createTenant(sql, { seed: 1010, now });
  ctx = await asAdminA(async (tx) => {
    const [client] = await tx<Ctx["client"][]>`select id, code, name, address from clients where address is not null order by code limit 1`;
    // 担当車両のあるドライバー。このドライバーの行は、デモデータに予定の無い早朝（4〜5時台）にする
    const [driver] = await tx<Ctx["driver"][]>`
      select d.id, d.code, d.name, va.vehicle_id from drivers d
        join vehicle_assignments va on va.driver_id = d.id and va.end_on is null
        join vehicles v on v.id = va.vehicle_id and v.status = 'active'
       where d.status = 'active' order by d.code limit 1`;
    const [leaveDriver] = await tx<{ code: string }[]>`select code from drivers where status = 'leave' limit 1`;
    const [maintenanceVehicle] = await tx<{ plate_number: string }[]>`select plate_number from vehicles where status = 'maintenance' limit 1`;
    return { client, driver, leaveDriver, maintenanceVehicle };
  });
});

afterAll(async () => {
  await dropTenant(sql, a);
  await dropTenant(sql, b);
  await sql.end();
});

function asAdminA<T>(fn: (tx: TransactionSql) => Promise<T>) {
  return runAsUser(sql, a.adminId, fn);
}
const asAdminB = <T>(fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, b.adminId, fn);

/** ひな形の列で1行を作る（指定しない列は空欄） */
const line = (values: Partial<Record<Col, string>>) => ORDER_IMPORT_HEADER.map((h) => values[h] ?? "");
const base = (): Partial<Record<Col, string>> => ({
  荷主: ctx.client.code, 配送先名: "CSVテスト商店", 配送先住所: "東京都品川区東品川2-3-14",
  集荷予定日時: `${slash} 9:00`, 配送予定日時: `${slash} 10:30`, 荷物の種類: "段ボール", 数量: "3", 配送料金: "4500",
});
/** 画面から送られるのと同じ流れ（CSV 文字列 → バイト列 → 文字コード判定 → 読み取り） */
function read(rows: string[][]) {
  const { text } = decodeCsvBytes(new TextEncoder().encode(toCsv([...ORDER_IMPORT_HEADER], rows)));
  const parsed = parseCsv(text);
  return readImportRows(parsed.header, parsed.rows).rows;
}

describe("取り込みの検証", () => {
  it("正しい行はエラーなし。担当ドライバーの車両・荷主の住所で空欄を補う", async () => {
    const result = await asAdminA((tx) => validateImportRows(tx, read([
      line({ ...base(), 担当ドライバー: ctx.driver.code, 集荷予定日時: `${slash} 4:00`, 配送予定日時: `${slash} 4:40` }),
      line({ ...base(), 配送先名: "CSVテスト倉庫", 集荷予定日時: `${slash} 13:00`, 配送予定日時: `${slash} 15:00` }),
    ]), now));
    expect(result.rows.flatMap((r) => r.errors)).toEqual([]);
    expect(result.warningCount).toBe(0);
    expect(result.values).toHaveLength(2);
    expect(result.values[0]).toMatchObject({ clientId: ctx.client.id, driverId: ctx.driver.id, vehicleId: ctx.driver.vehicle_id, quantity: 3, fee: 4500 });
    expect(result.values[1]).toMatchObject({ driverId: null, vehicleId: null, pickupAddress: ctx.client.address });
  });

  it("マスタに無い値・使えないドライバーや車両・過去の日付・不正な値はエラーになる", async () => {
    const rows = [
      line({ ...base(), 荷主: "存在しない荷主" }),
      line({ ...base(), 担当ドライバー: "存在しないドライバー" }),
      line({ ...base(), 配送予定日時: `${addDays(today, -1).replaceAll("-", "/")} 10:00`, 集荷予定日時: `${addDays(today, -1).replaceAll("-", "/")} 9:00` }),
      line({ ...base(), 数量: "たくさん", 配送料金: "-100" }),
      line({ ...base(), 集荷予定日時: `${slash} 11:00` }),
      line({ ...base(), 車両: "品川 999 ん 99-99" }),
    ];
    if (ctx.leaveDriver) rows.push(line({ ...base(), 担当ドライバー: ctx.leaveDriver.code }));
    if (ctx.maintenanceVehicle) rows.push(line({ ...base(), 担当ドライバー: ctx.driver.code, 車両: ctx.maintenanceVehicle.plate_number }));
    const result = await asAdminA((tx) => validateImportRows(tx, read(rows), now));
    const errors = result.rows.map((r) => r.errors.join(" / "));
    expect(errors[0]).toContain("荷主「存在しない荷主」が見つかりません");
    expect(errors[1]).toContain("ドライバー「存在しないドライバー」が見つかりません");
    expect(errors[2]).toContain("過去の日付");
    expect(errors[3]).toContain("数量「たくさん」は数字で入力してください");
    expect(errors[3]).toContain("配送料金");
    expect(errors[4]).toMatch(/配送予定日時/);
    expect(errors[5]).toContain("見つかりません");
    if (ctx.leaveDriver) expect(errors[6]).toContain("休職中または退職済み");
    if (ctx.maintenanceVehicle) expect(errors[7]).toContain("整備中または廃車");
    expect(result.errorCount).toBe(rows.length);
    expect(result.values).toHaveLength(0);
  });

  it("同じドライバーの時間の重なり（登録済み・ファイル内）と、同じ内容の行は注意になる（エラーではない）", async () => {
    const result = await asAdminA(async (tx) => {
      // 登録済みの案件と重なる行を作るため、2日後の予定がある案件を1件探す
      const [busy] = await tx<{ code: string; order_no: string; pickup_at: Date; delivery_at: Date }[]>`
        select d.code, o.order_no, o.pickup_at, o.delivery_at from delivery_orders o join drivers d on d.id = o.driver_id
         where o.status = 'assigned' and d.status = 'active' and o.delivery_at >= app.jst_start(${day}::date)
           and o.delivery_at < app.jst_start(${day}::date) + interval '1 day'
         order by o.order_no limit 1`;
      expect(busy).toBeDefined();
      const rows = [
        line({ ...base(), 担当ドライバー: busy.code, 集荷予定日時: formatCsvDateTime(busy.pickup_at), 配送予定日時: formatCsvDateTime(busy.delivery_at) }),
        line({ ...base(), 担当ドライバー: ctx.driver.code, 集荷予定日時: `${slash} 4:00`, 配送予定日時: `${slash} 4:40` }),
        line({ ...base(), 担当ドライバー: ctx.driver.code, 配送先名: "別の配送先", 集荷予定日時: `${slash} 4:20`, 配送予定日時: `${slash} 5:00` }),
        line({ ...base(), 配送先名: "同じ行" }),
        line({ ...base(), 配送先名: "同じ行" }),
      ];
      return { busy, result: await validateImportRows(tx, read(rows), now) };
    });
    const { busy, result: r } = result;
    expect(r.errorCount).toBe(0);
    expect(r.values).toHaveLength(5);
    expect(r.rows[0].warnings.join()).toContain(busy.order_no);
    expect(r.rows[1].warnings.join()).toContain("このファイルの中で");
    expect(r.rows[2].warnings.join()).toContain("このファイルの中で");
    expect(r.rows[3].warnings).toEqual([]);
    expect(r.rows[4].warnings.join()).toContain("5行目と同じ内容");
  });

  it("他社のマスタとは照合しない（他社にしか無い荷主コードは見つからない）", async () => {
    const code = `B-ONLY-${Date.now()}`;
    await asAdminB((tx) => tx`insert into clients (company_id, code, name) values (${b.companyId}, ${code}, '他社だけの荷主')`);
    const result = await asAdminA((tx) => validateImportRows(tx, read([line({ ...base(), 荷主: code })]), now));
    expect(result.rows[0].errors.join()).toContain(`荷主「${code}」が見つかりません`);
    expect(result.values).toHaveLength(0);
  });
});

describe("取り込みの登録", () => {
  it("行の順に案件番号を振り、担当ありは配車済・なしは未割当で登録し、ドライバーに通知する", async () => {
    const { inserted, rows } = await asAdminA(async (tx) => {
      const validated = await validateImportRows(tx, read([
        line({ ...base(), 配送先名: "CSV登録A", 担当ドライバー: ctx.driver.code, 集荷予定日時: `${slash} 5:10`, 配送予定日時: `${slash} 5:50` }),
        line({ ...base(), 配送先名: "CSV登録B", 備考: "改行を\n含む備考" }),
      ]), now);
      expect(validated.errorCount).toBe(0);
      const inserted = await insertImportedOrders(tx, a.companyId, validated.values);
      const rows = await tx<{ order_no: string; status: string; company_id: string; vehicle_id: string | null; notes: string | null; delivery_lat: number | null }[]>`
        select order_no, status, company_id, vehicle_id, notes, delivery_lat from delivery_orders where id in ${tx(inserted.map((r) => r.id))} order by order_no`;
      return { inserted, rows };
    });
    // ドライバー宛ての通知は管理者からは見えないため、RLS を通さずに確かめる
    const notices = await sql<{ kind: string }[]>`
      select kind from notifications where driver_id = ${ctx.driver.id} and link = ${`/driver/orders/${inserted[0].id}`}`;
    expect(inserted).toHaveLength(2);
    expect(Number(inserted[1].order_no.slice(3))).toBe(Number(inserted[0].order_no.slice(3)) + 1);
    expect(rows.map((r) => r.status)).toEqual(["assigned", "unassigned"]);
    expect(rows.every((r) => r.company_id === a.companyId)).toBe(true);
    expect(rows[0].vehicle_id).toBe(ctx.driver.vehicle_id);
    expect(rows[1].notes).toBe("改行を\n含む備考");
    expect(rows[0].delivery_lat).not.toBeNull();
    expect(notices.map((n) => n.kind)).toEqual(["assigned"]);
  });

  it("途中の行が DB のルールに反したら1件も登録しない（全件か0件か）", async () => {
    const marker = `全件か0件か-${Date.now()}`;
    await expect(asAdminA(async (tx) => {
      const [temp] = await tx<{ id: string; code: string }[]>`
        insert into clients (company_id, code, name) values (${a.companyId}, ${`T-${Date.now()}`}, 'テスト用の荷主') returning id, code`;
      const validated = await validateImportRows(tx, read([
        line({ ...base(), 配送先名: `${marker}-1` }),
        line({ ...base(), 配送先名: `${marker}-2`, 荷主: temp.code, 集荷先住所: "東京都港区芝浦1-1-1" }),
      ]), now);
      expect(validated.errorCount).toBe(0);
      // 確認した後に2行目の荷主が削除された（登録の直前に状況が変わった）→ 2行目の登録で外部キー違反
      await tx`delete from clients where id = ${temp.id}`;
      await insertImportedOrders(tx, a.companyId, validated.values);
    })).rejects.toThrow();
    const [{ n }] = await asAdminA((tx) => tx<{ n: number }[]>`select count(*)::int n from delivery_orders where delivery_name like ${`${marker}%`}`);
    // 1行目も残らない
    expect(n).toBe(0);
  });

  it("他社の会社 ID では登録できない（RLS）", async () => {
    await expect(asAdminA(async (tx) => {
      const validated = await validateImportRows(tx, read([line(base())]), now);
      await insertImportedOrders(tx, b.companyId, validated.values);
    })).rejects.toThrow();
  });
});

describe("書き出し", () => {
  it("一覧と同じ条件・件数で、自社の案件だけを配送予定順に書き出す", async () => {
    const filters = parseOrderFilters({ from: addDays(today, -6), to: today });
    const { exported, list, otherCompany } = await asAdminA(async (tx) => {
      const [exported, list] = await Promise.all([exportOrders(tx, filters), listOrders(tx, filters)]);
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from delivery_orders where company_id = ${b.companyId}`;
      return { exported, list, otherCompany: n };
    });
    expect(otherCompany).toBe(0);
    expect(exported.total).toBe(list.total);
    expect(exported.rows).toHaveLength(list.total);
    const times = exported.rows.map((r) => r.deliveryAt.getTime());
    expect(times).toEqual([...times].sort((x, y) => x - y));
    const [{ n }] = await asAdminA((tx) => tx<{ n: number }[]>`
      select count(*)::int n from delivery_orders
       where delivery_at >= app.jst_start(${filters.from!}::date) and delivery_at < app.jst_start(${filters.to!}::date + 1)`);
    expect(exported.total).toBe(n);
  });

  it("書き出した CSV を読み込むと同じ荷主・配送先・日時・料金になる（往復）", async () => {
    const filters = parseOrderFilters({ from: addDays(today, 1), to: addDays(today, 3) });
    const { rows } = await asAdminA((tx) => exportOrders(tx, filters));
    expect(rows.length).toBeGreaterThan(0);
    const csv = toCsv(ORDER_EXPORT_HEADER, rows.map((o) => [
      o.orderNo, o.clientCode, o.clientName, o.pickupAddress, o.deliveryName, o.deliveryAddress,
      formatCsvDateTime(o.pickupAt), formatCsvDateTime(o.deliveryAt), o.driverName, o.vehiclePlate,
      o.cargoType, o.quantity, o.fee, ORDER_STATUS_LABEL[o.status], o.isLate ? "遅延" : "",
      formatCsvDateTime(o.completedAt), o.invoiceNo, o.notes, formatCsvDateTime(o.createdAt), formatCsvDateTime(o.updatedAt),
    ]));
    const { text, encoding } = decodeCsvBytes(new TextEncoder().encode(csv));
    expect(encoding).toBe("utf-8");
    const parsed = parseCsv(text);
    const imported = readImportRows(parsed.header, parsed.rows);
    expect(imported.fileErrors).toEqual([]);
    const validated = await asAdminA((tx) => validateImportRows(tx, imported.rows, now));
    // 同じ内容の案件が既にあるので、キャンセル済み以外のすべての行に「二重登録でないか」の注意が出る
    const live = validated.rows.filter((r) => rows[r.line - 2].status !== "cancelled");
    expect(live.length).toBeGreaterThan(0);
    expect(live.every((r) => r.warnings.some((w) => w.includes("既にあります")))).toBe(true);
    const clients = await asAdminA((tx) => tx<{ id: string; code: string }[]>`select id, code from clients`);
    const codeOf = new Map(clients.map((c) => [c.id, c.code]));
    expect(validated.errorCount).toBe(0);
    validated.values.forEach((v) => {
      const o = rows[v.line - 2];
      expect(codeOf.get(v.clientId)).toBe(o.clientCode);
      expect(v.deliveryName).toBe(o.deliveryName.normalize("NFKC").replace(/\s+/g, " ").trim());
      expect(v.deliveryAt).toBe(formatCsvDateTime(o.deliveryAt).replaceAll("/", "-").replace(" ", "T"));
      expect(v.fee).toBe(o.fee);
    });
  });
});
