/**
 * デモデータ生成。
 * 同じ seed・同じ基準時刻（now）なら毎回同じ内容になる（ID は会社 ID から決まる）。
 * 出力は DB の列名そのままの行オブジェクトで、load.ts がそのまま一括登録する。
 */
import {
  addDays,
  addMinutes,
  dayOfWeek,
  daysBetween,
  endOfMonth,
  isHoliday,
  jstDateTime,
  startOfMonth,
  toJstDate,
  type DateString,
} from "@/lib/date";
import type { OrderStatus } from "@/lib/domain/status";
import type { ExpenseCategory } from "@/lib/domain/labels";
import {
  ADMIN_STAFF,
  AREAS,
  BUSINESS_PREFIXES,
  CANCEL_REASONS,
  CLIENTS,
  DEMO_COMPANY_NAME,
  DRIVERS,
  FAILURE_REASONS,
  OFFICES,
  VEHICLES,
  type ClientSeed,
} from "./master-data";
import { Random } from "./random";

export const DEFAULT_DEMO_SEED = 20261027;
/** 履歴を作る日数（売上・経費の6か月分） */
export const HISTORY_DAYS = 183;
/** 先の予定を作る日数 */
export const FUTURE_DAYS = 7;

export type GenerateOptions = {
  seed: number;
  now: Date;
  companyId: string;
  companyName?: string;
  isDemo: boolean;
  demoOwner?: string | null;
  demoExpiresAt?: Date | null;
};

type Row = Record<string, string | number | boolean | Date | null>;

export type DemoDataset = {
  company: Row;
  offices: Row[];
  drivers: Row[];
  vehicles: Row[];
  vehicleAssignments: Row[];
  clients: Row[];
  /** 荷主への請求（月末締め）。案件より先に登録する */
  invoices: Row[];
  orders: Row[];
  statusLogs: Row[];
  notes: Row[];
  expenses: Row[];
  notifications: Row[];
  /** 管理者デモで最初に表示するドライバー（ロール切替用） */
  featuredDriverId: string;
};

type PlannedOrder = {
  id: string;
  day: DateString;
  client: ClientSeed;
  clientId: string;
  pickupAt: Date;
  deliveryAt: Date;
  createdAt: Date;
  driverIndex: number | null;
  status: OrderStatus;
  completedAt: Date | null;
  fee: number;
  failureReason?: string;
  cancelReason?: string;
  cancelAt?: Date;
  assignedAt?: Date;
  pickedUpAt?: Date;
  departedAt?: Date;
  failedAt?: Date;
  row: Row;
};

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function roundTo(value: number, unit: number): number {
  return Math.max(unit, Math.round(value / unit) * unit);
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

/** その日の受注量の目安（平日・休日・月末・季節・成長） */
function demandFactor(day: DateString, startDay: DateString): number {
  const dow = dayOfWeek(day);
  let f = dow === 0 || isHoliday(day) ? 0.07 : dow === 6 ? 0.36 : 1;
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const monthEnd = endOfMonth(day);
  const daysToEnd = daysBetween(day, monthEnd);
  if (daysToEnd <= 3 && f === 1) f *= 1.3;
  else if (daysToEnd <= 6 && f === 1) f *= 1.12;
  if (date <= 5) f *= 0.94;
  const seasonal: Record<number, number> = { 1: 0.9, 3: 1.1, 7: 1.12, 8: 0.93, 12: 1.25 };
  f *= seasonal[month] ?? 1;
  if (month === 8 && date >= 13 && date <= 16) f *= 0.55;
  // ゆるやかな成長（6か月で約8%）
  f *= 1 + 0.00045 * daysBetween(startDay, day);
  return f;
}

/** 集荷時刻の候補（分）。朝と昼過ぎに山がある */
const PICKUP_SLOTS: { minute: number; weight: number }[] = [];
for (let m = 8 * 60; m <= 16 * 60; m += 15) {
  const h = m / 60;
  const weight = h < 9 ? 2.2 : h < 11 ? 3 : h < 12 ? 1.6 : h < 13 ? 0.8 : h < 15 ? 2 : 1;
  PICKUP_SLOTS.push({ minute: m, weight });
}

export function generateDemoData(options: GenerateOptions): DemoDataset {
  const rnd = new Random(options.seed);
  const ids = new Random(hashString(options.companyId) ^ options.seed);
  const now = options.now;
  const today = toJstDate(now);
  const startDay = addDays(today, -HISTORY_DAYS);
  const companyId = options.companyId;
  const nowMinutes = (now.getTime() - jstDateTime(today).getTime()) / 60_000;

  const company: Row = {
    id: companyId,
    name: options.companyName ?? DEMO_COMPANY_NAME,
    is_demo: options.isDemo,
    demo_owner: options.demoOwner ?? null,
    demo_expires_at: options.demoExpiresAt ?? null,
    demo_seed: options.seed,
    order_seq: 0,
    created_at: jstDateTime(addDays(today, -HISTORY_DAYS - 30), 9 * 60),
  };

  const officeIds = new Map<string, string>();
  const offices: Row[] = OFFICES.map((o) => {
    const id = ids.uuid();
    officeIds.set(o.key, id);
    return { id, company_id: companyId, name: o.name, address: o.address, lat: o.lat, lng: o.lng };
  });

  // ---- ドライバー ----
  const leaveStart = addDays(today, -40);
  const drivers = DRIVERS.map((d, i) => {
    const id = ids.uuid();
    const hiredOn = addDays(today, -Math.round(d.yearsAgo * 365 + rnd.int(20, 300)));
    // 新人は履歴期間の途中から稼働
    const hiredForSeed = d.yearsAgo === 0 ? addDays(today, -rnd.int(70, 110)) : hiredOn;
    return {
      seed: d,
      id,
      hiredOn: hiredForSeed,
      row: {
        id,
        company_id: companyId,
        code: `D-${String(i + 1).padStart(3, "0")}`,
        name: d.name,
        name_kana: d.kana,
        phone: `090-0000-${String(1001 + i * 37).padStart(4, "0")}`,
        email: `driver${String(i + 1).padStart(2, "0")}@minato-express.example`,
        office_id: officeIds.get(d.office) ?? null,
        employment_type: d.employment,
        status: d.status ?? "active",
        hired_on: hiredForSeed,
        notes: d.status === "leave" ? "体調不良のため休職中（復帰予定は未定）" : null,
      } as Row,
    };
  });

  // ---- 車両 ----
  const vehicles = VEHICLES.map((v, i) => {
    const id = ids.uuid();
    return {
      seed: v,
      id,
      row: {
        id,
        company_id: companyId,
        code: `V-${String(i + 1).padStart(3, "0")}`,
        plate_number: v.plate,
        vehicle_type: v.type,
        maker: v.maker,
        model: v.model,
        capacity_kg: v.capacityKg,
        inspection_expires_on: addDays(today, v.inspectionInDays),
        insurance_expires_on: addDays(today, v.insuranceInDays),
        status: v.status,
        notes: v.notes ?? null,
      } as Row,
    };
  });

  const driverVehicle = new Map<number, string>();
  const vehicleAssignments: Row[] = [];
  vehicles.forEach((v) => {
    if (v.seed.driver === undefined) return;
    driverVehicle.set(v.seed.driver, v.id);
    const driver = drivers[v.seed.driver];
    vehicleAssignments.push({
      id: ids.uuid(),
      company_id: companyId,
      vehicle_id: v.id,
      driver_id: driver.id,
      start_on: driver.hiredOn < startDay ? addDays(startDay, -rnd.int(30, 400)) : driver.hiredOn,
      end_on: null,
    });
  });

  // ---- 荷主 ----
  const clients = CLIENTS.map((c, i) => {
    const id = ids.uuid();
    return {
      seed: c,
      id,
      row: {
        id,
        company_id: companyId,
        code: `C-${String(i + 1).padStart(3, "0")}`,
        name: c.name,
        contact_name: c.contact,
        phone: c.phone,
        email: `logistics${String(i + 1).padStart(2, "0")}@client.example`,
        address: c.address,
        lat: c.lat,
        lng: c.lng,
        started_on: addDays(today, -Math.round(c.yearsAgo * 365 + rnd.int(30, 330))),
        notes: c.notes ?? null,
      } as Row,
    };
  });

  // ---- 配送案件 ----
  const planned: PlannedOrder[] = [];
  const workLog = new Map<string, { driver: number; orders: PlannedOrder[] }[]>();

  for (let offset = -HISTORY_DAYS; offset <= FUTURE_DAYS; offset++) {
    const day = addDays(today, offset);
    const factor = demandFactor(day, startDay);
    let count = Math.max(0, Math.round(42 * factor * (1 + rnd.normal() * 0.09)));
    // 先の日付は、まだ受注していない分を減らす
    if (offset > 0) count = Math.round(count * Math.max(0.2, 0.92 - offset * 0.11));
    if (count === 0) continue;

    // その日に出勤するドライバー
    const dow = dayOfWeek(day);
    const holiday = dow === 0 || isHoliday(day);
    const working: number[] = [];
    drivers.forEach((d, i) => {
      if (d.hiredOn > day) return;
      if (d.seed.status === "leave" && day >= leaveStart) return;
      const p = holiday ? 0.12 : dow === 6 ? 0.45 : 0.93;
      if (rnd.chance(p)) working.push(i);
    });
    if (working.length === 0) working.push(0);

    const schedules = new Map<number, { end: number; orders: PlannedOrder[] }>();
    working.forEach((i) => schedules.set(i, { end: 0, orders: [] }));

    const dayOrders: PlannedOrder[] = [];
    for (let k = 0; k < count; k++) {
      const clientEntry = rnd.weighted(clients, (c) => c.seed.weight);
      const client = clientEntry.seed;
      const area = rnd.pick(AREAS);
      const town = rnd.pick(area.towns);
      const pickupMinute = rnd.weighted(PICKUP_SLOTS, (s) => s.weight).minute;
      const distance = Math.hypot(area.lat - client.lat, area.lng - client.lng) * 100; // おおよその km
      const duration = Math.min(180, Math.round((35 + distance * 2.4 + rnd.int(0, 25)) / 5) * 5);
      const pickupAt = jstDateTime(day, pickupMinute);
      const deliveryAt = addMinutes(pickupAt, duration);
      const quantity = rnd.int(client.quantity[0], client.quantity[1]);
      const distanceFactor = 0.9 + Math.min(distance, 40) / 50;
      const quantityFactor = 1 + (quantity - client.quantity[0]) / (client.quantity[1] - client.quantity[0] + 1) * 0.25;
      const fee = roundTo(client.baseFee * distanceFactor * quantityFactor * rnd.float(0.95, 1.05), 100);
      const leadDays = rnd.weighted([0, 1, 1, 1, 2, 2, 3, 5], () => 1);
      let createdAt = jstDateTime(addDays(day, -leadDays), rnd.int(9 * 60, 18 * 60));
      if (createdAt.getTime() > pickupAt.getTime() - 60 * 60_000) createdAt = addMinutes(pickupAt, -rnd.int(60, 180));
      if (createdAt > now) createdAt = addMinutes(now, -rnd.int(10, 240));

      const prefix = rnd.pick(BUSINESS_PREFIXES);
      const kind = rnd.pick(client.destinations);
      const order: PlannedOrder = {
        id: ids.uuid(),
        day,
        client,
        clientId: clientEntry.id,
        pickupAt,
        deliveryAt,
        createdAt,
        driverIndex: null,
        status: "unassigned",
        completedAt: null,
        fee,
        row: {
          delivery_name: `${prefix}${kind} ${town}`,
          delivery_address: `${area.pref}${area.city}${town}${rnd.int(1, 6)}-${rnd.int(1, 28)}-${rnd.int(1, 20)}`,
          delivery_lat: Number((area.lat + rnd.normal() * 0.008).toFixed(6)),
          delivery_lng: Number((area.lng + rnd.normal() * 0.009).toFixed(6)),
          cargo_type: rnd.pick(client.cargo),
          quantity,
        },
      };
      dayOrders.push(order);
    }

    // 集荷時刻順にドライバーへ割り当て（空いている人を優先）
    dayOrders.sort((a, b) => a.pickupAt.getTime() - b.pickupAt.getTime());
    for (const order of dayOrders) {
      const start = (order.pickupAt.getTime() - jstDateTime(day).getTime()) / 60_000;
      const end = (order.deliveryAt.getTime() - jstDateTime(day).getTime()) / 60_000;
      const free = working.filter((i) => (schedules.get(i)?.end ?? 0) <= start - 10);
      let chosen: number | null;
      if (free.length > 0) {
        chosen = rnd.weighted(free, (i) => DRIVERS[i].capacity ** 3 / (1 + (schedules.get(i)?.orders.length ?? 0) * 0.15));
      } else {
        // 全員が埋まっている場合は、一番早く空く人に詰める（予定の重複が発生する）
        chosen = working.reduce((best, i) =>
          (schedules.get(i)?.end ?? 0) < (schedules.get(best)?.end ?? 0) ? i : best, working[0]);
      }
      const schedule = schedules.get(chosen);
      if (schedule) {
        schedule.end = Math.max(schedule.end, end);
        schedule.orders.push(order);
      }
      order.driverIndex = chosen;
    }
    workLog.set(day, working.map((i) => ({ driver: i, orders: schedules.get(i)?.orders ?? [] })));
    planned.push(...dayOrders);
  }

  // ---- ステータスを「今」に合わせて決める ----
  const tomorrow = addDays(today, 1);
  for (const order of planned) {
    const driverSeed = order.driverIndex !== null ? DRIVERS[order.driverIndex] : null;
    const isFutureDay = order.day > today;
    const assignLead = rnd.int(30, 20 * 60);
    order.assignedAt = minDate(
      new Date(Math.max(order.createdAt.getTime() + 10 * 60_000, order.pickupAt.getTime() - assignLead * 60_000)),
      now,
    );
    if (order.assignedAt <= order.createdAt) order.assignedAt = addMinutes(order.createdAt, 1);

    // 先の日付：一部は未割当のまま
    if (isFutureDay) {
      const pUnassigned = order.day === tomorrow ? 0.2 : 0.55;
      if (rnd.chance(pUnassigned) || order.assignedAt > now) {
        order.driverIndex = null;
        order.status = "unassigned";
      } else {
        order.status = "assigned";
      }
      if (rnd.chance(0.01)) {
        order.status = "cancelled";
        order.cancelReason = rnd.pick(CANCEL_REASONS);
        order.cancelAt = minDate(addMinutes(order.createdAt, rnd.int(30, 600)), now);
        if (order.cancelAt <= order.assignedAt) order.driverIndex = null;
      }
      continue;
    }

    // キャンセル（集荷前）
    if (rnd.chance(0.022)) {
      order.status = "cancelled";
      order.cancelReason = rnd.pick(CANCEL_REASONS);
      const latest = Math.min(order.pickupAt.getTime() - 20 * 60_000, now.getTime());
      const cancelAt = new Date(Math.max(order.createdAt.getTime() + 5 * 60_000, latest - rnd.int(0, 600) * 60_000));
      order.cancelAt = cancelAt;
      if (cancelAt <= order.assignedAt) order.driverIndex = null;
      continue;
    }

    const lateRate = driverSeed?.delayRate ?? 0.05;
    const isLateOrder = rnd.chance(lateRate);
    const completionOffset = isLateOrder ? rnd.int(20, 95) : rnd.int(-35, 12);
    const plannedCompletion = addMinutes(order.deliveryAt, completionOffset);
    order.pickedUpAt = addMinutes(order.pickupAt, rnd.int(-5, isLateOrder ? 25 : 8));
    order.departedAt = addMinutes(order.pickedUpAt, rnd.int(3, 12));
    const fails = rnd.chance(0.015);

    if (plannedCompletion <= now) {
      if (fails) {
        order.status = "failed";
        order.failedAt = plannedCompletion;
        order.failureReason = rnd.pick(FAILURE_REASONS);
      } else {
        order.status = "delivered";
        order.completedAt = plannedCompletion;
      }
    } else if (order.departedAt <= now) {
      order.status = "in_transit";
    } else if (order.pickedUpAt <= now) {
      order.status = "picked_up";
    } else {
      order.status = "assigned";
    }
  }

  // 本日の午後の案件の一部を未割当に（配車ボードで割り当てを体験できるように）
  const todayLater = planned
    .filter((o) => o.day === today && o.status === "assigned" && o.pickupAt.getTime() > now.getTime() + 60 * 60_000)
    .slice(-4);
  todayLater.forEach((o) => {
    o.status = "unassigned";
    o.driverIndex = null;
  });

  // 案件番号は受注順
  planned.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.pickupAt.getTime() - b.pickupAt.getTime());
  planned.forEach((o, i) => {
    o.row.order_no = `DM-${String(i + 1).padStart(6, "0")}`;
  });
  company.order_seq = planned.length;

  // ---- 行の作成：案件・履歴・メモ ----
  const orders: Row[] = [];
  const statusLogs: Row[] = [];
  const notes: Row[] = [];
  const admin = () => rnd.pick(ADMIN_STAFF);
  const log = (o: PlannedOrder, from: OrderStatus | null, to: OrderStatus, at: Date, by: string, note: string | null = null) => {
    statusLogs.push({
      id: ids.uuid(),
      company_id: companyId,
      order_id: o.id,
      from_status: from,
      to_status: to,
      changed_by: null,
      changed_by_name: by,
      note,
      created_at: at,
    });
  };

  for (const o of planned) {
    const driver = o.driverIndex !== null ? drivers[o.driverIndex] : null;
    const driverName = driver?.seed.name ?? "";
    const vehicleId = o.driverIndex !== null ? driverVehicle.get(o.driverIndex) ?? null : null;
    const clientEntry = clients.find((c) => c.id === o.clientId);
    // 最終更新は最後の履歴の時刻
    let updatedAt = o.createdAt;

    log(o, null, "unassigned", o.createdAt, admin());
    const reachedAssigned = driver !== null || (o.status === "cancelled" && o.driverIndex !== null);
    if (reachedAssigned && o.assignedAt) {
      log(o, "unassigned", "assigned", o.assignedAt, admin());
      updatedAt = o.assignedAt;
    }
    if (o.status === "cancelled") {
      const at = new Date(Math.max((o.cancelAt ?? o.createdAt).getTime(), updatedAt.getTime() + 60_000));
      log(o, reachedAssigned ? "assigned" : "unassigned", "cancelled", at, admin(), o.cancelReason ?? null);
      updatedAt = at;
    }
    if (["picked_up", "in_transit", "delivered", "failed"].includes(o.status) && o.pickedUpAt) {
      log(o, "assigned", "picked_up", o.pickedUpAt, driverName);
      updatedAt = o.pickedUpAt;
    }
    if (["in_transit", "delivered", "failed"].includes(o.status) && o.departedAt) {
      log(o, "picked_up", "in_transit", o.departedAt, driverName);
      updatedAt = o.departedAt;
    }
    if (o.status === "delivered" && o.completedAt) {
      const at = new Date(Math.max(o.completedAt.getTime(), updatedAt.getTime() + 60_000));
      o.completedAt = at;
      log(o, "in_transit", "delivered", at, driverName);
      updatedAt = at;
    }
    if (o.status === "failed" && o.failedAt) {
      const at = new Date(Math.max(o.failedAt.getTime(), updatedAt.getTime() + 60_000));
      log(o, "in_transit", "failed", at, driverName, o.failureReason ?? null);
      updatedAt = at;
      notes.push({
        id: ids.uuid(), company_id: companyId, order_id: o.id, author_id: null,
        author_name: driverName, body: o.failureReason ?? "持ち戻り", created_at: at,
      });
    }
    if (o.status === "delivered" && rnd.chance(0.03)) {
      notes.push({
        id: ids.uuid(), company_id: companyId, order_id: o.id, author_id: null, author_name: driverName,
        body: rnd.pick(["裏口の搬入口から納品", "受付で受領印をもらいました", "次回から2階の倉庫へ直接納品とのこと"]),
        created_at: o.completedAt ?? updatedAt,
      });
    }

    orders.push({
      id: o.id,
      company_id: companyId,
      order_no: o.row.order_no as string,
      client_id: o.clientId,
      pickup_address: clientEntry?.seed.address ?? "",
      pickup_lat: clientEntry?.seed.lat ?? null,
      pickup_lng: clientEntry?.seed.lng ?? null,
      delivery_name: o.row.delivery_name as string,
      delivery_address: o.row.delivery_address as string,
      delivery_lat: o.row.delivery_lat as number,
      delivery_lng: o.row.delivery_lng as number,
      pickup_at: o.pickupAt,
      delivery_at: o.deliveryAt,
      driver_id: o.status === "unassigned" ? null : driver?.id ?? null,
      vehicle_id: o.status === "unassigned" ? null : vehicleId,
      cargo_type: o.row.cargo_type as string,
      quantity: o.row.quantity as number,
      fee: o.fee,
      status: o.status,
      completed_at: o.status === "delivered" ? o.completedAt : null,
      notes: rnd.chance(0.08) ? rnd.pick(["午前中必着", "要事前連絡", "台車使用可", "時間指定厳守", "納品書2部"]) : null,
      // 請求は最後にまとめて作る（下の「請求」）
      invoice_id: null,
      invoiced: false,
      created_by: null,
      created_at: o.createdAt,
      updated_at: updatedAt,
    });
  }

  // ---- 経費 ----
  const expenses: Row[] = [];
  const expense = (day: DateString, category: ExpenseCategory, amount: number, description: string,
    driverId: string | null = null, vehicleId: string | null = null) => {
    if (amount <= 0) return;
    expenses.push({
      id: ids.uuid(), company_id: companyId, spent_on: day, category, amount: Math.round(amount),
      driver_id: driverId, vehicle_id: vehicleId, description, created_at: jstDateTime(day, 18 * 60),
    });
  };

  for (let offset = -HISTORY_DAYS; offset <= 0; offset++) {
    const day = addDays(today, offset);
    const isToday = offset === 0;
    // 月初の固定費
    if (day.slice(8, 10) === "01") {
      vehicles.forEach((v) => {
        if (v.seed.status !== "standby" || rnd.chance(0.5)) {
          expense(day, "vehicle_maintenance", v.seed.type === "2tトラック" ? 52000 : v.seed.type === "1tバン" ? 34000 : 24000,
            "リース料・減価償却（月額）", null, v.id);
        }
      });
      expense(day, "other", 150000, "駐車場代（2営業所・月額）");
      expense(day, "other", 46000, "通信費・業務用スマートフォン（月額）");
      expense(day, "other", 33000, "配車システム・会計ソフト利用料（月額）");
    }
    if (isToday && nowMinutes < 18 * 60) {
      // 今日の変動費は業務終了後に計上する
      continue;
    }
    const worked = workLog.get(day) ?? [];
    const dow = dayOfWeek(day);
    if (dow !== 0 && dow !== 6 && !isHoliday(day)) {
      expense(day, "labor", 34000 + rnd.int(-1500, 1500), "事務・配車スタッフ人件費（日割り）");
    }
    for (const w of worked) {
      const done = w.orders.filter((o) => o.status === "delivered" || o.status === "failed");
      if (done.length === 0) continue;
      const driver = drivers[w.driver];
      const vehicleId = driverVehicle.get(w.driver) ?? null;
      const vehicleSeed = VEHICLES.find((v) => v.driver === w.driver);
      const fuelFactor = vehicleSeed?.type === "2tトラック" ? 1.7 : vehicleSeed?.type === "1tバン" ? 1.25 : 1;
      expense(day, "fuel", (1300 + done.length * 420 + rnd.int(-200, 300)) * fuelFactor, "燃料費（給油カード）", driver.id, vehicleId);
      const tollCount = done.filter(() => rnd.chance(0.22)).length;
      if (tollCount > 0) expense(day, "toll", tollCount * rnd.int(640, 1900), "高速道路料金（ETC）", driver.id, vehicleId);
      if (driver.seed.employment === "full_time") {
        expense(day, "labor", 12000 + driver.seed.yearsAgo * 350 + done.length * 200, "ドライバー人件費（日割り）", driver.id, null);
      } else {
        const revenue = w.orders.filter((o) => o.status === "delivered").reduce((s, o) => s + o.fee, 0);
        expense(day, "outsourcing", roundTo(revenue * 0.6, 10), "業務委託料（売上の60%）", driver.id, vehicleId);
      }
    }
    // ときどき発生する整備・その他
    vehicles.forEach((v) => {
      if (v.seed.status === "active" && rnd.chance(1 / 160)) {
        const item = rnd.pick([
          { label: "オイル交換", amount: [6000, 9000] },
          { label: "タイヤ交換", amount: [28000, 64000] },
          { label: "バッテリー交換", amount: [14000, 22000] },
          { label: "点検整備", amount: [18000, 45000] },
        ] as const);
        expense(day, "vehicle_maintenance", rnd.int(item.amount[0], item.amount[1]), item.label, null, v.id);
      }
    });
    if (rnd.chance(0.25)) {
      expense(day, "other", rnd.int(1500, 12000), rnd.pick(["梱包資材", "事務用品", "駐車料金（コインパーキング）", "清掃用品"]));
    }
  }
  const maintenanceVehicle = vehicles.find((v) => v.seed.status === "maintenance");
  if (maintenanceVehicle) {
    expense(addDays(today, -2), "vehicle_maintenance", 86000, "ブレーキ整備（入庫時見積）", null, maintenanceVehicle.id);
  }

  // ---- 通知 ----
  const notifications: Row[] = [];
  const todayOrders = planned.filter((o) => o.day === today);
  todayOrders
    .filter((o) => o.status === "delivered" || o.status === "failed")
    .slice(-6)
    .forEach((o) => {
      const driverName = o.driverIndex !== null ? DRIVERS[o.driverIndex].name : "";
      const delivered = o.status === "delivered";
      notifications.push({
        id: ids.uuid(), company_id: companyId, audience: "admin", driver_id: null,
        kind: delivered ? "delivered" : "failed",
        title: delivered ? "配送が完了しました" : "配送に失敗しました",
        body: `${o.row.order_no} ${o.row.delivery_name}（${driverName}）`,
        link: `/orders/${o.id}`,
        read_at: null,
        created_at: o.completedAt ?? o.failedAt ?? now,
      });
    });
  todayOrders
    .filter((o) => o.status === "assigned" && o.driverIndex !== null)
    .forEach((o) => {
      notifications.push({
        id: ids.uuid(), company_id: companyId, audience: "driver",
        driver_id: drivers[o.driverIndex as number].id, kind: "assigned",
        title: "新しい配送が割り当てられました", body: `${o.row.order_no} ${o.row.delivery_name}`,
        link: `/driver/orders/${o.id}`, read_at: null, created_at: o.assignedAt ?? now,
      });
    });

  // ---- 請求（月末締め・翌月5日発行） ----
  // 締め済みの月の配送完了分を荷主ごとにまとめる。発行日が来ていない月は未請求のまま。
  // 直近の締め月は3社を未請求で残し、荷主画面の「請求済みにする」を試せるようにする。
  const invoices: Row[] = [];
  const thisMonth = startOfMonth(today);
  const lastClosed = startOfMonth(addDays(thisMonth, -1));
  const unbilledLastMonth = new Set<string>();
  while (unbilledLastMonth.size < Math.min(3, clients.length)) unbilledLastMonth.add(rnd.pick(clients).id);
  const orderRows = new Map(orders.map((r) => [r.id as string, r]));
  const groups = new Map<string, { month: DateString; clientIndex: number; orders: PlannedOrder[] }>();
  for (const o of planned) {
    if (o.status !== "delivered" || o.day >= thisMonth) continue;
    const month = startOfMonth(o.day);
    const key = `${month}|${o.clientId}`;
    const group = groups.get(key) ?? { month, clientIndex: clients.findIndex((c) => c.id === o.clientId), orders: [] };
    group.orders.push(o);
    groups.set(key, group);
  }
  const monthSeq = new Map<string, number>();
  [...groups.values()]
    .sort((a, b) => a.month.localeCompare(b.month) || a.clientIndex - b.clientIndex)
    .forEach((g) => {
      const issuedOn = addDays(endOfMonth(g.month), 5);
      if (issuedOn > today) return;
      if (g.month === lastClosed && unbilledLastMonth.has(clients[g.clientIndex].id)) return;
      const seq = (monthSeq.get(g.month) ?? 0) + 1;
      monthSeq.set(g.month, seq);
      const id = ids.uuid();
      const issuedAt = new Date(Math.min(jstDateTime(issuedOn, 10 * 60).getTime(), now.getTime()));
      invoices.push({
        id,
        company_id: companyId,
        client_id: clients[g.clientIndex].id,
        invoice_no: `INV-${g.month.slice(0, 4)}${g.month.slice(5, 7)}-${String(seq).padStart(3, "0")}`,
        period_start: g.month,
        period_end: endOfMonth(g.month),
        order_count: g.orders.length,
        amount: g.orders.reduce((s, o) => s + o.fee, 0),
        issued_on: issuedOn,
        notes: null,
        created_by: null,
        created_at: issuedAt,
        updated_at: issuedAt,
      });
      for (const o of g.orders) {
        const row = orderRows.get(o.id);
        if (row) {
          row.invoice_id = id;
          row.invoiced = true;
        }
      }
    });

  // ロール切替で使うドライバー：本日の担当が最も多い人
  const todayCount = new Map<number, number>();
  todayOrders.forEach((o) => {
    if (o.driverIndex !== null && o.status !== "cancelled") {
      todayCount.set(o.driverIndex, (todayCount.get(o.driverIndex) ?? 0) + 1);
    }
  });
  const featured = [...todayCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;

  return {
    company,
    offices,
    drivers: drivers.map((d) => d.row),
    vehicles: vehicles.map((v) => v.row),
    vehicleAssignments,
    clients: clients.map((c) => c.row),
    invoices,
    orders,
    statusLogs,
    notes,
    expenses,
    notifications,
    featuredDriverId: drivers[featured].id,
  };
}
