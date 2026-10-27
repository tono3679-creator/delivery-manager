"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { asAdmin, type CurrentUser } from "@/lib/auth";
import type { Tx } from "@/lib/db";
import { todayJst } from "@/lib/date";
import { approximateLocation } from "@/lib/domain/location";
import {
  assignVehicleSchema, clientSchema, driverSchema, vehicleSchema,
  type ClientInput, type DriverInput, type VehicleInput,
} from "@/lib/validation/master";
import { isUniqueViolation, toFieldErrors, toUserMessage } from "./errors";

export type MasterSaveResult =
  | { ok: true; id: string; code: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type MasterActionResult = { ok: true } | { ok: false; error: string };

const ACTIVE = ["assigned", "picked_up", "in_transit"] as const;

function audit(tx: Tx, user: CurrentUser, action: string, entity: string, id: string, detail: Record<string, unknown>) {
  return tx`insert into audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
            values (${user.companyId}, ${user.userId}, ${user.displayName}, ${action}, ${entity}, ${id}, ${tx.json(detail as never)})`;
}

/** マスタが変わると、配車候補・ダッシュボード・分析の表示も変わる */
function revalidateMasters(path: string, id?: string) {
  revalidatePath(path);
  if (id) revalidatePath(`${path}/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/dispatch");
  revalidatePath("/orders", "layout");
  revalidatePath("/analytics", "layout");
}

const invalidId = (id: string | undefined) => id !== undefined && !z.uuid().safeParse(id).success;

// ---------------------------------------------------------------
// ドライバー
// ---------------------------------------------------------------

/**
 * ドライバーの登録・更新。管理コード（D-001…）は DB が自動で振る。
 * 対応中の案件があるドライバーを休職・退職にすることはできない（DB でも拒否する）。
 */
export async function saveDriver(input: DriverInput, id?: string): Promise<MasterSaveResult> {
  const parsed = driverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力内容を確認してください", fieldErrors: toFieldErrors(parsed.error) };
  if (invalidId(id)) return { ok: false, error: "ドライバーが見つかりません" };
  const v = parsed.data;
  const values = {
    name: v.name,
    name_kana: v.nameKana || null,
    phone: v.phone || null,
    email: v.email || null,
    office_id: v.officeId,
    employment_type: v.employmentType,
    status: v.status,
    hired_on: v.hiredOn,
    notes: v.notes || null,
  };
  try {
    const result = await asAdmin(async (tx, user): Promise<MasterSaveResult> => {
      if (v.officeId) {
        const [office] = await tx`select 1 from offices where id = ${v.officeId}`;
        if (!office) return { ok: false, error: "入力内容を確認してください", fieldErrors: { officeId: "営業所が見つかりません" } };
      }
      let row: { id: string; code: string } | undefined;
      if (id) {
        const [current] = await tx<{ status: string; active: number }[]>`
          select status, (select count(*) from delivery_orders where driver_id = d.id and status in ${tx(ACTIVE)}) active
            from drivers d where id = ${id} for update`;
        if (!current) return { ok: false, error: "ドライバーが見つかりません（削除された可能性があります）" };
        if (["leave", "retired"].includes(v.status) && current.status !== v.status && current.active > 0) {
          return {
            ok: false,
            error: `対応中の案件が${current.active}件あるため、休職・退職にできません。先に配車ボードで担当を変更してください`,
            fieldErrors: { status: "対応中の案件があります" },
          };
        }
        [row] = await tx<{ id: string; code: string }[]>`update drivers set ${tx(values)} where id = ${id} returning id, code`;
      } else {
        [row] = await tx<{ id: string; code: string }[]>`
          insert into drivers ${tx({ ...values, company_id: user.companyId })} returning id, code`;
      }
      await audit(tx, user, id ? "update" : "create", "driver", row!.id, { code: row!.code, name: v.name, status: v.status });
      return { ok: true, id: row!.id, code: row!.code };
    });
    if (result.ok) revalidateMasters("/drivers", result.id);
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e) };
  }
}

/** 削除できるのは配送実績のないドライバーだけ（実績があれば「退職」にする） */
export async function deleteDriver(id: string): Promise<MasterActionResult> {
  if (invalidId(id)) return { ok: false, error: "ドライバーが見つかりません" };
  try {
    const result = await asAdmin(async (tx, user): Promise<MasterActionResult> => {
      const [d] = await tx<{ name: string; code: string; orders: number; logins: number }[]>`
        select name, code,
               (select count(*) from delivery_orders where driver_id = d.id) orders,
               (select count(*) from profiles where driver_id = d.id) logins
          from drivers d where id = ${id} for update`;
      if (!d) return { ok: false, error: "ドライバーが見つかりません" };
      if (d.orders > 0) return { ok: false, error: `配送実績（${d.orders}件）があるため削除できません。退職にすると配車の候補から外れます` };
      if (d.logins > 0) return { ok: false, error: "ログインアカウントが紐づいているため削除できません" };
      await tx`delete from drivers where id = ${id}`;
      await audit(tx, user, "delete", "driver", id, { code: d.code, name: d.name });
      return { ok: true };
    });
    if (result.ok) revalidateMasters("/drivers");
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "削除に失敗しました") };
  }
}

// ---------------------------------------------------------------
// 車両
// ---------------------------------------------------------------

/**
 * 車両の登録・更新。対応中の案件で使っている車両は整備中・廃車にできない（DB でも拒否する）。
 * 廃車にすると担当ドライバーは外れる（DB のトリガー）。
 */
export async function saveVehicle(input: VehicleInput, id?: string): Promise<MasterSaveResult> {
  const parsed = vehicleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力内容を確認してください", fieldErrors: toFieldErrors(parsed.error) };
  if (invalidId(id)) return { ok: false, error: "車両が見つかりません" };
  const v = parsed.data;
  const values = {
    plate_number: v.plateNumber,
    vehicle_type: v.vehicleType,
    maker: v.maker,
    model: v.model || null,
    capacity_kg: v.capacityKg === "" ? null : v.capacityKg,
    inspection_expires_on: v.inspectionExpiresOn,
    insurance_expires_on: v.insuranceExpiresOn,
    status: v.status,
    notes: v.notes || null,
  };
  try {
    const result = await asAdmin(async (tx, user): Promise<MasterSaveResult> => {
      let row: { id: string; code: string } | undefined;
      if (id) {
        const [current] = await tx<{ status: string; active: number }[]>`
          select status, (select count(*) from delivery_orders where vehicle_id = v.id and status in ${tx(ACTIVE)}) active
            from vehicles v where id = ${id} for update`;
        if (!current) return { ok: false, error: "車両が見つかりません（削除された可能性があります）" };
        if (["maintenance", "retired"].includes(v.status) && current.status !== v.status && current.active > 0) {
          return {
            ok: false,
            error: `対応中の案件${current.active}件で使われているため、整備中・廃車にできません。先に案件の車両を変更してください`,
            fieldErrors: { status: "対応中の案件で使用中です" },
          };
        }
        [row] = await tx<{ id: string; code: string }[]>`update vehicles set ${tx(values)} where id = ${id} returning id, code`;
      } else {
        [row] = await tx<{ id: string; code: string }[]>`
          insert into vehicles ${tx({ ...values, company_id: user.companyId })} returning id, code`;
      }
      await audit(tx, user, id ? "update" : "create", "vehicle", row!.id, { code: row!.code, plate: v.plateNumber, status: v.status });
      return { ok: true, id: row!.id, code: row!.code };
    });
    if (result.ok) revalidateMasters("/vehicles", result.id);
    return result;
  } catch (e) {
    unstable_rethrow(e);
    if (isUniqueViolation(e, "plate_number")) {
      return { ok: false, error: "入力内容を確認してください", fieldErrors: { plateNumber: "この車両番号は既に登録されています" } };
    }
    return { ok: false, error: toUserMessage(e) };
  }
}

/** 削除できるのは利用実績（案件・経費）のない車両だけ（実績があれば「廃車」にする） */
export async function deleteVehicle(id: string): Promise<MasterActionResult> {
  if (invalidId(id)) return { ok: false, error: "車両が見つかりません" };
  try {
    const result = await asAdmin(async (tx, user): Promise<MasterActionResult> => {
      const [v] = await tx<{ plate_number: string; code: string; orders: number; expenses: number }[]>`
        select plate_number, code,
               (select count(*) from delivery_orders where vehicle_id = v.id) orders,
               (select count(*) from expenses where vehicle_id = v.id) expenses
          from vehicles v where id = ${id} for update`;
      if (!v) return { ok: false, error: "車両が見つかりません" };
      if (v.orders + v.expenses > 0) {
        return { ok: false, error: "案件や経費の記録があるため削除できません。廃車にすると配車の候補から外れます" };
      }
      await tx`delete from vehicles where id = ${id}`;
      await audit(tx, user, "delete", "vehicle", id, { code: v.code, plate: v.plate_number });
      return { ok: true };
    });
    if (result.ok) revalidateMasters("/vehicles");
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "削除に失敗しました") };
  }
}

/**
 * 担当車両の変更。今の担当（車両側・ドライバー側の両方）を今日で終えて、新しい担当を今日から始める。
 * 既に割り当て済みの案件の車両は変えない（配車ボードで新しく割り当てた案件から反映される）。
 */
export async function assignVehicle(input: z.input<typeof assignVehicleSchema>): Promise<MasterActionResult> {
  const parsed = assignVehicleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "不正な操作です" };
  const { vehicleId, driverId } = parsed.data;
  const today = todayJst();
  try {
    const result = await asAdmin(async (tx, user): Promise<MasterActionResult> => {
      const [vehicle] = await tx<{ plate_number: string; status: string; current_driver: string | null }[]>`
        select v.plate_number, v.status, va.driver_id current_driver
          from vehicles v left join vehicle_assignments va on va.vehicle_id = v.id and va.end_on is null
         where v.id = ${vehicleId} for update of v`;
      if (!vehicle) return { ok: false, error: "車両が見つかりません" };
      if (vehicle.current_driver === driverId) return { ok: true };
      let driverName: string | null = null;
      if (driverId) {
        if (vehicle.status === "retired") return { ok: false, error: "廃車の車両は担当にできません" };
        const [driver] = await tx<{ name: string; status: string }[]>`select name, status from drivers where id = ${driverId} for update`;
        if (!driver) return { ok: false, error: "ドライバーが見つかりません" };
        if (driver.status === "retired") return { ok: false, error: `${driver.name}さんは退職済みのため担当にできません` };
        driverName = driver.name;
      }
      // 車両の今の担当と、ドライバーの今の車両を終える（同じ日に付け替えた場合は 0 日の履歴になる）
      await tx`update vehicle_assignments set end_on = greatest(start_on, ${today}::date)
                where end_on is null and (vehicle_id = ${vehicleId} ${driverId ? tx`or driver_id = ${driverId}` : tx``})`;
      if (driverId) {
        await tx`insert into vehicle_assignments (company_id, vehicle_id, driver_id, start_on)
                 values (${user.companyId}, ${vehicleId}, ${driverId}, ${today})`;
      }
      await audit(tx, user, driverId ? "assign_vehicle" : "unassign_vehicle", "vehicle", vehicleId, {
        plate: vehicle.plate_number, from: vehicle.current_driver, to: driverId, driverName,
      });
      return { ok: true };
    });
    if (result.ok) {
      revalidateMasters("/vehicles", vehicleId);
      revalidatePath("/drivers", "layout");
    }
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "担当を変更できませんでした") };
  }
}

// ---------------------------------------------------------------
// 荷主
// ---------------------------------------------------------------

export async function saveClient(input: ClientInput, id?: string): Promise<MasterSaveResult> {
  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力内容を確認してください", fieldErrors: toFieldErrors(parsed.error) };
  if (invalidId(id)) return { ok: false, error: "荷主が見つかりません" };
  const v = parsed.data;
  const loc = v.address ? approximateLocation(v.address) : null;
  const values = {
    name: v.name,
    contact_name: v.contactName || null,
    phone: v.phone || null,
    email: v.email || null,
    address: v.address || null,
    lat: loc?.lat ?? null,
    lng: loc?.lng ?? null,
    started_on: v.startedOn || null,
    notes: v.notes || null,
  };
  try {
    const result = await asAdmin(async (tx, user): Promise<MasterSaveResult> => {
      let row: { id: string; code: string } | undefined;
      if (id) {
        [row] = await tx<{ id: string; code: string }[]>`update clients set ${tx(values)} where id = ${id} returning id, code`;
        if (!row) return { ok: false, error: "荷主が見つかりません（削除された可能性があります）" };
      } else {
        [row] = await tx<{ id: string; code: string }[]>`
          insert into clients ${tx({ ...values, company_id: user.companyId })} returning id, code`;
      }
      await audit(tx, user, id ? "update" : "create", "client", row.id, { code: row.code, name: v.name });
      return { ok: true, id: row.id, code: row.code };
    });
    if (result.ok) revalidateMasters("/clients", result.id);
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e) };
  }
}

/** 削除できるのは案件のない荷主だけ（売上の履歴を残すため） */
export async function deleteClient(id: string): Promise<MasterActionResult> {
  if (invalidId(id)) return { ok: false, error: "荷主が見つかりません" };
  try {
    const result = await asAdmin(async (tx, user): Promise<MasterActionResult> => {
      const [c] = await tx<{ name: string; code: string; orders: number }[]>`
        select name, code, (select count(*) from delivery_orders where client_id = c.id) orders
          from clients c where id = ${id} for update`;
      if (!c) return { ok: false, error: "荷主が見つかりません" };
      if (c.orders > 0) return { ok: false, error: `案件（${c.orders}件）があるため削除できません。売上の履歴を残すため、取引が終わった荷主もそのまま残してください` };
      await tx`delete from clients where id = ${id}`;
      await audit(tx, user, "delete", "client", id, { code: c.code, name: c.name });
      return { ok: true };
    });
    if (result.ok) revalidateMasters("/clients");
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "削除に失敗しました") };
  }
}
