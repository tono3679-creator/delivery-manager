"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { asAdmin } from "@/lib/auth";
import { findDriverConflicts, orderVersion } from "@/lib/data/orders";
import { approximateLocation } from "@/lib/domain/location";
import { canTransition, DELETABLE_STATUSES, ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/domain/status";
import { formatTime } from "@/lib/format";
import { noteSchema, orderFormSchema, parseLocalDateTime, statusChangeSchema, type OrderFormInput } from "@/lib/validation/order";
import { toFieldErrors, toUserMessage } from "./errors";

export type Conflict = { id: string; orderNo: string; deliveryName: string; window: string };

export type SaveResult =
  | { ok: true; id: string; orderNo: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; stale?: true }
  | { ok: false; needsConfirm: true; conflicts: Conflict[] };

function revalidateOrders(id?: string) {
  revalidatePath("/orders");
  revalidatePath("/dashboard");
  revalidatePath("/dispatch");
  revalidatePath("/driver", "layout");
  if (id) revalidatePath(`/orders/${id}`);
}

/**
 * 配送案件の登録・更新。
 * 同じドライバーの予定と時間が重なる場合は、confirmOverlap が無ければ保存せずに確認を求める（警告）。
 * 休職中ドライバーへの割当などは DB 側で保存を拒否する（保存禁止）。
 * 編集では version（編集を開いたときの更新の印）を受け取り、その後に他の人やドライバーが更新していたら上書きしない。
 */
export async function saveOrder(
  input: OrderFormInput,
  options: { id?: string; confirmOverlap?: boolean; version?: string } = {},
): Promise<SaveResult> {
  const parsed = orderFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力内容を確認してください", fieldErrors: toFieldErrors(parsed.error) };
  const v = parsed.data;
  if (options.id && !z.uuid().safeParse(options.id).success) return { ok: false, error: "案件が見つかりません" };
  const pickupAt = parseLocalDateTime(v.pickupAt);
  const deliveryAt = parseLocalDateTime(v.deliveryAt);
  const loc = approximateLocation(v.deliveryAddress);

  try {
    return await asAdmin(async (tx, user) => {
      // 編集時は、担当か時刻が変わったときだけ重複を確認する（料金の修正などで毎回警告しない）
      let scheduleChanged = true;
      if (options.id) {
        const [current] = await tx<{
          status: string; driver_id: string | null; pickup_at: Date; delivery_at: Date; client_id: string; fee: number; invoice_id: string | null;
          version: string;
        }[]>`
          select status, driver_id, pickup_at, delivery_at, client_id, fee, invoice_id, ${orderVersion(tx)} version
            from delivery_orders o where id = ${options.id} for update`;
        if (!current) return { ok: false as const, error: "案件が見つかりません（削除された可能性があります）" };
        if (options.version && current.version !== options.version) {
          return {
            ok: false as const,
            stale: true as const,
            error: "編集している間に、この案件が他の人またはドライバーによって更新されました。最新の内容を読み込んでから、もう一度編集してください",
          };
        }
        // 請求済みの案件は請求金額の根拠（料金・荷主・配送日）を変えられない（DB のトリガーでも拒否する）
        if (current.invoice_id) {
          const fieldErrors: Record<string, string> = {};
          if (current.fee !== v.fee) fieldErrors.fee = "請求済みのため変更できません";
          if (current.client_id !== v.clientId) fieldErrors.clientId = "請求済みのため変更できません";
          if (current.delivery_at.getTime() !== deliveryAt.getTime()) fieldErrors.deliveryAt = "請求済みのため変更できません";
          if (Object.keys(fieldErrors).length > 0) {
            return { ok: false as const, error: "請求済みの案件は料金・荷主・配送日を変更できません（請求を取り消してから変更してください）", fieldErrors };
          }
        }
        if (["picked_up", "in_transit"].includes(current.status) && current.driver_id !== v.driverId) {
          return { ok: false as const, error: "集荷後の案件はドライバーを変更できません", fieldErrors: { driverId: "集荷後は変更できません" } };
        }
        scheduleChanged = current.driver_id !== v.driverId
          || current.pickup_at.getTime() !== pickupAt.getTime()
          || current.delivery_at.getTime() !== deliveryAt.getTime();
      }
      if (v.driverId && scheduleChanged && !options.confirmOverlap) {
        const conflicts = await findDriverConflicts(tx, v.driverId, pickupAt, deliveryAt, options.id);
        if (conflicts.length > 0) {
          return {
            ok: false as const,
            needsConfirm: true as const,
            conflicts: conflicts.map((c) => ({
              id: c.id, orderNo: c.order_no, deliveryName: c.delivery_name,
              window: `${formatTime(c.pickup_at)}〜${formatTime(c.delivery_at)}`,
            })),
          };
        }
      }
      const [client] = await tx<{ lat: number | null; lng: number | null; address: string | null }[]>`
        select lat, lng, address from clients where id = ${v.clientId}`;
      if (!client) return { ok: false as const, error: "荷主が見つかりません" };
      const pickupLoc = client.address === v.pickupAddress ? { lat: client.lat, lng: client.lng } : approximateLocation(v.pickupAddress);

      const values = {
        client_id: v.clientId,
        pickup_address: v.pickupAddress,
        pickup_lat: pickupLoc?.lat ?? null,
        pickup_lng: pickupLoc?.lng ?? null,
        delivery_name: v.deliveryName,
        delivery_address: v.deliveryAddress,
        delivery_lat: loc?.lat ?? null,
        delivery_lng: loc?.lng ?? null,
        pickup_at: pickupAt,
        delivery_at: deliveryAt,
        driver_id: v.driverId,
        vehicle_id: v.vehicleId,
        cargo_type: v.cargoType,
        quantity: v.quantity,
        fee: v.fee,
        notes: v.notes || null,
      };

      let row: { id: string; order_no: string } | undefined;
      if (options.id) {
        [row] = await tx<{ id: string; order_no: string }[]>`
          update delivery_orders set ${tx(values)} where id = ${options.id} returning id, order_no`;
        if (!row) return { ok: false as const, error: "案件が見つかりません（削除された可能性があります）" };
      } else {
        [row] = await tx<{ id: string; order_no: string }[]>`
          insert into delivery_orders ${tx({ ...values, company_id: user.companyId })} returning id, order_no`;
      }
      await tx`insert into audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
               values (${user.companyId}, ${user.userId}, ${user.displayName}, ${options.id ? "update" : "create"},
                       'delivery_order', ${row.id}, ${tx.json({ orderNo: row.order_no, overlapConfirmed: Boolean(options.confirmOverlap) })})`;
      return { ok: true as const, id: row.id, orderNo: row.order_no };
    }).then((result) => {
      if (result.ok) revalidateOrders(result.id);
      return result;
    });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e) };
  }
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/** 削除できるのは集荷前の案件のみ（売上や履歴の整合性を保つため、完了済みはキャンセル扱い） */
export async function deleteOrder(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "案件が見つかりません" };
  try {
    const result = await asAdmin(async (tx, user) => {
      const [row] = await tx<{ status: OrderStatus; order_no: string }[]>`select status, order_no from delivery_orders where id = ${id} for update`;
      if (!row) return { ok: false as const, error: "案件が見つかりません" };
      if (!DELETABLE_STATUSES.includes(row.status)) {
        return { ok: false as const, error: "集荷後の案件は削除できません。配送失敗またはキャンセルとして記録してください" };
      }
      await tx`delete from delivery_orders where id = ${id}`;
      await tx`insert into audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
               values (${user.companyId}, ${user.userId}, ${user.displayName}, 'delete', 'delivery_order', ${id},
                       ${tx.json({ orderNo: row.order_no })})`;
      return { ok: true as const };
    });
    if (result.ok) revalidateOrders();
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "削除に失敗しました") };
  }
}

/** 管理者によるステータス変更（画面に表示していたステータスと一致する場合のみ） */
export async function changeOrderStatus(input: z.input<typeof statusChangeSchema>): Promise<ActionResult> {
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "不正な操作です" };
  const { orderId, expected, to, note } = parsed.data;
  if (!canTransition(expected, to)) {
    return { ok: false, error: `「${ORDER_STATUS_LABEL[expected]}」から「${ORDER_STATUS_LABEL[to]}」には変更できません` };
  }
  if ((to === "failed" || to === "cancelled") && !note) return { ok: false, error: "理由を入力してください" };
  try {
    await asAdmin((tx) => tx`select admin_update_status(${orderId}, ${expected}, ${to}, ${note ?? null})`);
    revalidateOrders(orderId);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "ステータスを変更できませんでした") };
  }
}

export async function addOrderNote(input: z.input<typeof noteSchema>): Promise<ActionResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "入力内容を確認してください" };
  try {
    await asAdmin((tx, user) => tx`
      insert into delivery_notes (company_id, order_id, author_id, author_name, body)
      values (${user.companyId}, ${parsed.data.orderId}, ${user.userId}, ${user.displayName}, ${parsed.data.body})`);
    revalidatePath(`/orders/${parsed.data.orderId}`);
    revalidatePath("/driver", "layout");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "メモを保存できませんでした") };
  }
}
