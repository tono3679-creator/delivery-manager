import { z } from "zod";

/** 'YYYY-MM-DDTHH:mm'（日本時間として扱う） */
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "日時を入力してください");

const optionalId = z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v));

/** 配送案件の登録・編集フォーム（画面とサーバーで同じスキーマを使う） */
export const orderFormSchema = z
  .object({
    clientId: z.uuid("荷主を選択してください"),
    pickupAddress: z.string().trim().min(1, "集荷先住所を入力してください").max(200, "200文字以内で入力してください"),
    deliveryName: z.string().trim().min(1, "配送先名を入力してください").max(100, "100文字以内で入力してください"),
    deliveryAddress: z.string().trim().min(1, "配送先住所を入力してください").max(200, "200文字以内で入力してください"),
    pickupAt: localDateTime,
    deliveryAt: localDateTime,
    driverId: optionalId,
    vehicleId: optionalId,
    cargoType: z.string().trim().min(1, "荷物の種類を入力してください").max(50, "50文字以内で入力してください"),
    quantity: z.number("数量を入力してください").int("整数で入力してください").min(1, "1以上で入力してください").max(9999, "9999以下で入力してください"),
    fee: z.number("配送料金を入力してください").int("円単位の整数で入力してください").min(0, "0円以上で入力してください").max(9_999_999, "金額が大きすぎます"),
    notes: z.string().trim().max(500, "500文字以内で入力してください"),
  })
  .refine((v) => v.deliveryAt >= v.pickupAt, { path: ["deliveryAt"], message: "配送予定は集荷予定より後にしてください" })
  .refine((v) => !v.vehicleId || v.driverId, { path: ["vehicleId"], message: "車両を指定するときはドライバーも指定してください" });

export type OrderFormInput = z.input<typeof orderFormSchema>;
export type OrderFormValues = z.output<typeof orderFormSchema>;

/** フォームの日時（日本時間）→ Date */
export function parseLocalDateTime(value: string): Date {
  return new Date(`${value}:00+09:00`);
}

/** Date → フォームの日時（日本時間） */
export function toLocalDateTime(at: Date | string): string {
  const d = new Date(new Date(at).getTime() + 9 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export const noteSchema = z.object({
  orderId: z.uuid(),
  body: z.string().trim().min(1, "メモを入力してください").max(1000, "1000文字以内で入力してください"),
});

export const statusChangeSchema = z.object({
  orderId: z.uuid(),
  expected: z.enum(["unassigned", "assigned", "picked_up", "in_transit", "delivered", "failed", "cancelled"]),
  to: z.enum(["unassigned", "assigned", "picked_up", "in_transit", "delivered", "failed", "cancelled"]),
  note: z.string().trim().max(500).optional(),
});

/** 新規登録フォームの初期値（指定日の 9:00〜10:00） */
export function emptyOrderForm(day: string): OrderFormInput {
  return {
    clientId: "",
    pickupAddress: "",
    deliveryName: "",
    deliveryAddress: "",
    pickupAt: `${day}T09:00`,
    deliveryAt: `${day}T10:00`,
    driverId: "",
    vehicleId: "",
    cargoType: "",
    quantity: 1,
    fee: 0,
    notes: "",
  };
}

/** 登録済みの案件 → 編集フォームの初期値 */
export function orderToForm(o: {
  clientId: string; pickupAddress: string; deliveryName: string; deliveryAddress: string;
  pickupAt: Date; deliveryAt: Date; driverId: string | null; vehicleId: string | null;
  cargoType: string; quantity: number; fee: number; notes: string | null;
}): OrderFormInput {
  return {
    clientId: o.clientId,
    pickupAddress: o.pickupAddress,
    deliveryName: o.deliveryName,
    deliveryAddress: o.deliveryAddress,
    pickupAt: toLocalDateTime(o.pickupAt),
    deliveryAt: toLocalDateTime(o.deliveryAt),
    driverId: o.driverId ?? "",
    vehicleId: o.vehicleId ?? "",
    cargoType: o.cargoType,
    quantity: o.quantity,
    fee: o.fee,
    notes: o.notes ?? "",
  };
}
