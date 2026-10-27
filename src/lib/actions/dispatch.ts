"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { asAdmin } from "@/lib/auth";
import { findDriverConflicts } from "@/lib/data/orders";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/domain/status";
import { formatTime } from "@/lib/format";
import type { Conflict } from "./orders";
import { toUserMessage } from "./errors";

const assignSchema = z
  .object({
    orderId: z.uuid(),
    /** null で配車解除 */
    driverId: z.uuid().nullable(),
    /** 時刻も動かすとき（ISO 8601） */
    pickupAt: z.iso.datetime({ offset: true }).optional(),
    deliveryAt: z.iso.datetime({ offset: true }).optional(),
    /** 画面に表示していた状態。DB と違えば保存しない（同時操作の防止） */
    expectedStatus: z.enum(ORDER_STATUSES),
    expectedDriverId: z.uuid().nullable(),
    confirmOverlap: z.boolean().optional(),
  })
  .refine((v) => (v.pickupAt === undefined) === (v.deliveryAt === undefined), { message: "集荷と配送の時刻は両方指定してください" })
  .refine((v) => !v.pickupAt || !v.deliveryAt || new Date(v.deliveryAt) >= new Date(v.pickupAt), {
    message: "配送予定は集荷予定より後にしてください",
  });

export type AssignInput = z.input<typeof assignSchema>;

export type AssignResult =
  | { ok: true; orderNo: string }
  | { ok: false; error: string; stale?: boolean }
  | { ok: false; needsConfirm: true; conflicts: Conflict[] };

const DISPATCHABLE: readonly OrderStatus[] = ["unassigned", "assigned"];

/**
 * 配車（担当ドライバー・予定時刻の変更、配車解除）。配車ボードのドラッグ&ドロップと案件詳細から使う。
 *   ・同じドライバーの予定と重なる場合は confirmOverlap が無ければ保存しない（警告）
 *   ・休職中のドライバー、整備中の車両などは DB が保存を拒否する（保存禁止）
 */
export async function assignOrder(input: AssignInput): Promise<AssignResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "不正な操作です" };
  const v = parsed.data;

  try {
    const result = await asAdmin(async (tx, user): Promise<AssignResult> => {
      const [row] = await tx<{
        status: OrderStatus; driver_id: string | null; vehicle_id: string | null; order_no: string; pickup_at: Date; delivery_at: Date;
      }[]>`
        select status, driver_id, vehicle_id, order_no, pickup_at, delivery_at
          from delivery_orders where id = ${v.orderId} for update`;
      if (!row) return { ok: false, error: "案件が見つかりません（削除された可能性があります）", stale: true };
      if (row.status !== v.expectedStatus || row.driver_id !== v.expectedDriverId) {
        return { ok: false, error: `${row.order_no} は他の操作で更新されています。最新の状態を表示しました`, stale: true };
      }
      if (!DISPATCHABLE.includes(row.status)) {
        return { ok: false, error: "集荷前（未割当・配車済）の案件のみ配車を変更できます" };
      }

      const pickupAt = v.pickupAt ? new Date(v.pickupAt) : row.pickup_at;
      const deliveryAt = v.deliveryAt ? new Date(v.deliveryAt) : row.delivery_at;

      if (v.driverId && !v.confirmOverlap) {
        const conflicts = await findDriverConflicts(tx, v.driverId, pickupAt, deliveryAt, v.orderId);
        if (conflicts.length > 0) {
          return {
            ok: false,
            needsConfirm: true,
            conflicts: conflicts.map((c) => ({
              id: c.id, orderNo: c.order_no, deliveryName: c.delivery_name,
              window: `${formatTime(c.pickup_at)}〜${formatTime(c.delivery_at)}`,
            })),
          };
        }
      }

      // 車両：同じドライバーなら今の車両のまま。担当が変わったらそのドライバーの担当車両（使える場合）
      let vehicleId: string | null = null;
      if (v.driverId && v.driverId === row.driver_id) {
        vehicleId = row.vehicle_id;
      } else if (v.driverId) {
        const [assigned] = await tx<{ vehicle_id: string }[]>`
          select va.vehicle_id from vehicle_assignments va join vehicles ve on ve.id = va.vehicle_id
           where va.driver_id = ${v.driverId} and va.end_on is null and ve.status in ('active', 'standby')
           limit 1`;
        vehicleId = assigned?.vehicle_id ?? null;
      }

      await tx`
        update delivery_orders
           set driver_id = ${v.driverId}, vehicle_id = ${vehicleId}, pickup_at = ${pickupAt}, delivery_at = ${deliveryAt}
         where id = ${v.orderId}`;
      await tx`insert into audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
               values (${user.companyId}, ${user.userId}, ${user.displayName}, ${v.driverId ? "dispatch" : "unassign"},
                       'delivery_order', ${v.orderId},
                       ${tx.json({
                         orderNo: row.order_no,
                         fromDriverId: row.driver_id,
                         toDriverId: v.driverId,
                         timeChanged: Boolean(v.pickupAt),
                         overlapConfirmed: Boolean(v.confirmOverlap),
                       })})`;
      return { ok: true, orderNo: row.order_no };
    });
    if (result.ok) {
      revalidatePath("/dispatch");
      revalidatePath("/orders");
      revalidatePath(`/orders/${v.orderId}`);
      revalidatePath("/dashboard");
      revalidatePath("/driver", "layout");
    }
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "配車を保存できませんでした") };
  }
}
