/** ドライバー・車両・荷主・経費の入力チェック（画面とサーバーで同じスキーマを使う） */
import { z } from "zod";
import { addMonths, isDateString } from "@/lib/date";
import { DRIVER_STATUSES, EMPLOYMENT_TYPES, EXPENSE_CATEGORIES, VEHICLE_STATUSES } from "@/lib/domain/labels";

const text = (label: string, max: number) =>
  z.string().trim().min(1, `${label}を入力してください`).max(max, `${max}文字以内で入力してください`);
const optionalText = (max: number) => z.string().trim().max(max, `${max}文字以内で入力してください`);
const date = (label: string) => z.string().refine(isDateString, `${label}を入力してください`);
const optionalDate = z.union([z.literal(""), z.string().refine(isDateString, "日付の形式が正しくありません")]);
const optionalId = z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v));

/** 電話番号：数字・ハイフン・括弧・+ のみ */
const phone = z
  .string()
  .trim()
  .max(20, "20文字以内で入力してください")
  .regex(/^[0-9+\-() ]*$/, "数字とハイフンで入力してください");
const email = z.union([z.literal(""), z.email("メールアドレスの形式が正しくありません").max(200)]);

export const driverSchema = z.object({
  name: text("氏名", 50),
  nameKana: optionalText(50).regex(/^[\p{Script=Katakana}ー・\s]*$/u, "カタカナで入力してください"),
  phone,
  email,
  officeId: optionalId,
  employmentType: z.enum(EMPLOYMENT_TYPES),
  status: z.enum(DRIVER_STATUSES),
  hiredOn: date("入社日・契約開始日"),
  notes: optionalText(500),
});
export type DriverInput = z.input<typeof driverSchema>;
export type DriverValues = z.output<typeof driverSchema>;

export const vehicleSchema = z.object({
  plateNumber: text("車両番号", 30),
  vehicleType: text("車種", 30),
  maker: text("メーカー", 30),
  model: optionalText(50),
  capacityKg: z.union([z.literal(""), z.coerce.number().int("整数で入力してください").min(1, "1以上で入力してください").max(50_000, "大きすぎます")]),
  inspectionExpiresOn: date("車検満了日"),
  insuranceExpiresOn: date("保険満了日"),
  status: z.enum(VEHICLE_STATUSES),
  notes: optionalText(500),
});
export type VehicleInput = z.input<typeof vehicleSchema>;
export type VehicleValues = z.output<typeof vehicleSchema>;

export const clientSchema = z.object({
  name: text("会社名", 100),
  contactName: optionalText(50),
  phone,
  email,
  address: optionalText(200),
  startedOn: optionalDate,
  notes: optionalText(500),
});
export type ClientInput = z.input<typeof clientSchema>;
export type ClientValues = z.output<typeof clientSchema>;

export const expenseSchema = z.object({
  spentOn: date("日付"),
  category: z.enum(EXPENSE_CATEGORIES, "カテゴリを選択してください"),
  amount: z.number("金額を入力してください").int("円単位の整数で入力してください").min(0, "0円以上で入力してください").max(99_999_999, "金額が大きすぎます"),
  driverId: optionalId,
  vehicleId: optionalId,
  description: optionalText(200),
});
export type ExpenseInput = z.input<typeof expenseSchema>;
export type ExpenseValues = z.output<typeof expenseSchema>;

export const assignVehicleSchema = z.object({
  vehicleId: z.uuid(),
  /** null で担当なしにする */
  driverId: z.uuid().nullable(),
});

// ---------------------------------------------------------------
// 新規登録フォームの初期値
// ---------------------------------------------------------------

export function emptyDriverForm(today: string): DriverInput {
  return {
    name: "", nameKana: "", phone: "", email: "", officeId: "", employmentType: "full_time", status: "active", hiredOn: today, notes: "",
  };
}

/** 車検は2年後、保険は1年後を仮の満了日にする */
export function emptyVehicleForm(today: string): VehicleInput {
  return {
    plateNumber: "", vehicleType: "", maker: "", model: "", capacityKg: "",
    inspectionExpiresOn: addMonths(today, 24), insuranceExpiresOn: addMonths(today, 12), status: "active", notes: "",
  };
}

export const EMPTY_CLIENT_FORM: ClientInput = { name: "", contactName: "", phone: "", email: "", address: "", startedOn: "", notes: "" };
