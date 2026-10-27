import "server-only";
import type { Tx } from "@/lib/db";
import { addDays, todayJst, type DateString } from "@/lib/date";
import { approximateLocation } from "@/lib/domain/location";
import { overlappingIds, overlaps } from "@/lib/domain/schedule";
import { FIELD_LABEL, matchKey, type ImportRow } from "@/lib/csv/orders";
import { orderFormSchema, parseLocalDateTime, type OrderFormValues } from "@/lib/validation/order";

/** 入力チェックのエラーに付ける項目名 */
const LABEL: Record<string, string> = {
  pickupAddress: FIELD_LABEL.pickupAddress, deliveryName: FIELD_LABEL.deliveryName, deliveryAddress: FIELD_LABEL.deliveryAddress,
  deliveryAt: FIELD_LABEL.deliveryAt, cargoType: FIELD_LABEL.cargoType, quantity: FIELD_LABEL.quantity, fee: FIELD_LABEL.fee,
  notes: FIELD_LABEL.notes, vehicleId: FIELD_LABEL.vehicle,
};

export type ImportPreviewRow = {
  line: number;
  deliveryAt: string | null;
  clientName: string;
  deliveryName: string;
  driverName: string | null;
  fee: number | null;
  errors: string[];
  warnings: string[];
};

export type ValidatedImport = {
  rows: ImportPreviewRow[];
  /** すべての行にエラーが無いときだけ登録に使う値 */
  values: (OrderFormValues & { line: number })[];
  errorCount: number;
  warningCount: number;
};

type Masters = {
  clients: { id: string; code: string; name: string; address: string | null; lat: number | null; lng: number | null }[];
  drivers: { id: string; code: string; name: string; status: string; vehicle_id: string | null }[];
  vehicles: { id: string; plate_number: string; status: string }[];
};

async function loadMasters(tx: Tx): Promise<Masters> {
  const [clients, drivers, vehicles] = await Promise.all([
    tx<Masters["clients"]>`select id, code, name, address, lat, lng from clients`,
    tx<Masters["drivers"]>`
      select d.id, d.code, d.name, d.status, va.vehicle_id from drivers d
        left join vehicle_assignments va on va.driver_id = d.id and va.end_on is null`,
    tx<Masters["vehicles"]>`select id, plate_number, status from vehicles`,
  ]);
  return { clients, drivers, vehicles };
}

/** コードか名前で探す（同じ名前が複数あるときは決められないので null） */
function lookup<T>(items: T[], value: string, keys: ((item: T) => string)[]): { hit: T | null; ambiguous: boolean } {
  const key = matchKey(value);
  for (const k of keys) {
    const hits = items.filter((item) => matchKey(k(item)) === key);
    if (hits.length === 1) return { hit: hits[0], ambiguous: false };
    if (hits.length > 1) return { hit: null, ambiguous: true };
  }
  return { hit: null, ambiguous: false };
}

/**
 * 取り込む行をマスタと照合して検証する（登録の直前にも同じ処理をもう一度行う）。
 * エラー：登録できない（荷主・ドライバーが見つからない、必須項目、過去の日付、休職中・整備中など）
 * 注意：登録はできるが確認してほしい（同じドライバーの時間の重複、同じ案件らしきものが既にある、予定時刻を過ぎている）
 */
export async function validateImportRows(tx: Tx, input: ImportRow[], now = new Date()): Promise<ValidatedImport> {
  const masters = await loadMasters(tx);
  const today: DateString = todayJst(now);
  const lastDay = addDays(today, 366);
  const rows: ImportPreviewRow[] = [];
  const values: ValidatedImport["values"] = [];

  for (const r of input) {
    const errors: string[] = [];
    const warnings: string[] = [];

    const client = r.client ? lookup(masters.clients, r.client, [(c) => c.code, (c) => c.name]) : { hit: null, ambiguous: false };
    if (!r.client) errors.push("荷主を入力してください");
    else if (client.ambiguous) errors.push(`荷主「${r.client}」が複数あります。荷主コードで指定してください`);
    else if (!client.hit) errors.push(`荷主「${r.client}」が見つかりません（荷主コードか登録済みの会社名を入力してください）`);

    let driver: Masters["drivers"][number] | null = null;
    if (r.driver) {
      const found = lookup(masters.drivers, r.driver, [(d) => d.code, (d) => d.name]);
      if (found.ambiguous) errors.push(`ドライバー「${r.driver}」が複数います。ドライバーコードで指定してください`);
      else if (!found.hit) errors.push(`ドライバー「${r.driver}」が見つかりません`);
      else if (found.hit.status === "leave" || found.hit.status === "retired") {
        errors.push(`${found.hit.name}さんは休職中または退職済みのため割り当てできません`);
      } else driver = found.hit;
    }

    let vehicleId: string | null = null;
    if (r.vehicle) {
      const found = lookup(masters.vehicles, r.vehicle, [(v) => v.plate_number]);
      if (!found.hit) errors.push(`車両「${r.vehicle}」が見つかりません（車両番号を入力してください）`);
      else if (found.hit.status === "maintenance" || found.hit.status === "retired") {
        errors.push(`車両 ${found.hit.plate_number} は整備中または廃車のため使用できません`);
      } else vehicleId = found.hit.id;
    } else if (driver?.vehicle_id) {
      // 車両の指定が無ければ、ドライバーの担当車両（使える状態のとき）
      const v = masters.vehicles.find((x) => x.id === driver!.vehicle_id);
      if (v && v.status === "active") vehicleId = v.id;
    }

    if (r.pickupAt === null) errors.push(r.raw.pickupAt ? `集荷予定日時「${r.raw.pickupAt}」を読み取れません（例：2026/10/28 9:00）` : "集荷予定日時を入力してください");
    if (r.deliveryAt === null) errors.push(r.raw.deliveryAt ? `配送予定日時「${r.raw.deliveryAt}」を読み取れません（例：2026/10/28 10:30）` : "配送予定日時を入力してください");
    if (r.deliveryAt) {
      const day = r.deliveryAt.slice(0, 10);
      if (day < today) errors.push("配送予定日が過去の日付です");
      else if (day > lastDay) errors.push("配送予定日は1年以内にしてください");
      else if (parseLocalDateTime(r.deliveryAt) < now) warnings.push("配送予定の時刻を過ぎています（登録するとすぐ遅延になります）");
    }
    if (r.quantity !== null && Number.isNaN(r.quantity)) errors.push(`数量「${r.raw.quantity}」は数字で入力してください`);
    if (r.fee !== null && Number.isNaN(r.fee)) errors.push(`配送料金「${r.raw.fee}」は数字で入力してください`);

    const parsed = orderFormSchema.safeParse({
      clientId: client.hit?.id ?? "00000000-0000-4000-8000-000000000000",
      pickupAddress: r.pickupAddress || client.hit?.address || "",
      deliveryName: r.deliveryName,
      deliveryAddress: r.deliveryAddress,
      pickupAt: r.pickupAt ?? "",
      deliveryAt: r.deliveryAt ?? "",
      driverId: driver?.id ?? "",
      vehicleId: driver ? vehicleId ?? "" : "",
      cargoType: r.cargoType,
      quantity: r.quantity === null ? undefined : r.quantity,
      fee: r.fee === null ? undefined : r.fee,
      notes: r.notes,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "");
        // 上で個別に伝えている項目（荷主・日時の読み取り・数字の形式）は重ねて出さない
        if (field === "clientId") continue;
        // 荷主が見つからないときは、荷主の住所で補えなかった集荷先住所のエラーも出さない
        if (field === "pickupAddress" && !client.hit && !r.pickupAddress) continue;
        if ((field === "pickupAt" && r.pickupAt === null) || (field === "deliveryAt" && r.deliveryAt === null)) continue;
        if ((field === "quantity" && Number.isNaN(r.quantity)) || (field === "fee" && Number.isNaN(r.fee))) continue;
        const label = LABEL[field];
        // 「数量を入力してください」のように項目名を含むメッセージはそのまま
        const message = label && !issue.message.startsWith(label) ? `${label}：${issue.message}` : issue.message;
        if (!errors.includes(message)) errors.push(message);
      }
    }
    if (r.vehicle && !r.driver) {
      errors.push("車両を指定するときは担当ドライバーも指定してください");
    }

    rows.push({
      line: r.line,
      deliveryAt: r.deliveryAt,
      clientName: client.hit?.name ?? r.client,
      deliveryName: r.deliveryName,
      driverName: driver?.name ?? (r.driver || null),
      fee: r.fee !== null && !Number.isNaN(r.fee) ? r.fee : null,
      errors,
      warnings,
    });
    if (errors.length === 0 && parsed.success) values.push({ ...parsed.data, line: r.line });
  }

  // ここからは注意（警告）：同じドライバーの時間の重複・同じ案件らしきもの
  if (values.length > 0) {
    const times = values.map((v) => ({ start: parseLocalDateTime(v.pickupAt), end: parseLocalDateTime(v.deliveryAt) }));
    const from = new Date(Math.min(...times.map((t) => t.start.getTime())));
    const to = new Date(Math.max(...times.map((t) => t.end.getTime())));
    const driverIds = [...new Set(values.map((v) => v.driverId).filter((id): id is string => Boolean(id)))];
    const [existing, similar] = await Promise.all([
      driverIds.length === 0
        ? Promise.resolve([] as { id: string; order_no: string; driver_id: string; pickup_at: Date; delivery_at: Date }[])
        : tx<{ id: string; order_no: string; driver_id: string; pickup_at: Date; delivery_at: Date }[]>`
            select id, order_no, driver_id, pickup_at, delivery_at from delivery_orders
             where driver_id in ${tx(driverIds)} and status in ('assigned','picked_up','in_transit')
               and pickup_at < ${to} and delivery_at > ${from}`,
      tx<{ order_no: string; client_id: string; delivery_name: string; delivery_at: Date }[]>`
        select order_no, client_id, delivery_name, delivery_at from delivery_orders
         where delivery_at >= ${from} and delivery_at <= ${to} and status <> 'cancelled'`,
    ]);
    const warn = (line: number, message: string) => {
      const row = rows.find((x) => x.line === line);
      if (row && !row.warnings.includes(message)) row.warnings.push(message);
    };
    values.forEach((v, i) => {
      if (v.driverId) {
        const clash = existing.filter((e) => e.driver_id === v.driverId && overlaps(times[i], { start: e.pickup_at, end: e.delivery_at }));
        if (clash.length > 0) warn(v.line, `同じドライバーの登録済みの案件と時間が重なっています（${clash.map((c) => c.order_no).slice(0, 3).join("、")}）`);
      }
      const same = similar.find((s) => s.client_id === v.clientId && matchKey(s.delivery_name) === matchKey(v.deliveryName)
        && s.delivery_at.getTime() === times[i].end.getTime());
      if (same) warn(v.line, `同じ荷主・配送先・配送予定日時の案件が既にあります（${same.order_no}）。二重登録でないか確認してください`);
    });
    // ファイルの中での重複
    for (const driverId of driverIds) {
      const mine = values.map((v, i) => ({ v, i })).filter(({ v }) => v.driverId === driverId);
      const ids = overlappingIds(mine.map(({ v, i }) => ({ id: String(v.line), start: times[i].start, end: times[i].end })));
      for (const id of ids) warn(Number(id), "このファイルの中で、同じドライバーの時間が重なっている行があります");
    }
    const seen = new Map<string, number>();
    values.forEach((v) => {
      const key = `${v.clientId}|${matchKey(v.deliveryName)}|${v.deliveryAt}`;
      const first = seen.get(key);
      if (first !== undefined) warn(v.line, `${first}行目と同じ内容です。二重登録でないか確認してください`);
      else seen.set(key, v.line);
    });
  }

  return {
    rows,
    values,
    errorCount: rows.filter((r) => r.errors.length > 0).length,
    warningCount: rows.filter((r) => r.warnings.length > 0).length,
  };
}

/** 検証済みの値をまとめて登録する（1つのトランザクションで、全件か0件か） */
export async function insertImportedOrders(tx: Tx, companyId: string, values: ValidatedImport["values"]) {
  const clients = new Map(
    (await tx<{ id: string; address: string | null; lat: number | null; lng: number | null }[]>`select id, address, lat, lng from clients`).map((c) => [c.id, c]),
  );
  const rows = values.map((v) => {
    const client = clients.get(v.clientId);
    const pickupLoc = client && client.address === v.pickupAddress ? { lat: client.lat, lng: client.lng } : approximateLocation(v.pickupAddress);
    const loc = approximateLocation(v.deliveryAddress);
    return {
      company_id: companyId,
      client_id: v.clientId,
      pickup_address: v.pickupAddress,
      pickup_lat: pickupLoc?.lat ?? null,
      pickup_lng: pickupLoc?.lng ?? null,
      delivery_name: v.deliveryName,
      delivery_address: v.deliveryAddress,
      delivery_lat: loc?.lat ?? null,
      delivery_lng: loc?.lng ?? null,
      pickup_at: parseLocalDateTime(v.pickupAt),
      delivery_at: parseLocalDateTime(v.deliveryAt),
      driver_id: v.driverId,
      vehicle_id: v.vehicleId,
      cargo_type: v.cargoType,
      quantity: v.quantity,
      fee: v.fee,
      notes: v.notes || null,
    };
  });
  // 行の順に案件番号が振られるよう、1件ずつ登録する（トリガーで採番・配車済への変更・通知を行う）
  const inserted: { id: string; order_no: string }[] = [];
  for (const row of rows) {
    const [r] = await tx<{ id: string; order_no: string }[]>`insert into delivery_orders ${tx(row)} returning id, order_no`;
    inserted.push(r);
  }
  return inserted;
}
