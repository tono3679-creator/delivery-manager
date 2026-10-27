/** 設定画面の入力チェック（画面とサーバーで同じスキーマを使う） */
import { z } from "zod";

const text = (label: string, max: number) =>
  z.string().trim().min(1, `${label}を入力してください`).max(max, `${max}文字以内で入力してください`);

export const companySchema = z.object({
  name: text("会社名", 100),
});
export type CompanyInput = z.input<typeof companySchema>;

export const officeSchema = z.object({
  name: text("営業所名", 50),
  address: text("住所", 200),
});
export type OfficeInput = z.input<typeof officeSchema>;
export const EMPTY_OFFICE_FORM: OfficeInput = { name: "", address: "" };
