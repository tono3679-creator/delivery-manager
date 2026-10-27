"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { asAdmin } from "@/lib/auth";
import { addDays, todayJst } from "@/lib/date";
import { EXPENSE_CATEGORY_LABEL } from "@/lib/domain/labels";
import { expenseSchema, type ExpenseInput } from "@/lib/validation/master";
import { toFieldErrors, toUserMessage } from "./errors";

export type ExpenseSaveResult = { ok: true; id: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** 3年より前の経費は登録しない（入力ミスの防止） */
const OLDEST_DAYS = 365 * 3;

function revalidateExpenses() {
  revalidatePath("/analytics", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/vehicles", "layout");
}

/** 経費の登録・更新。未来日は登録できない（売上・利益の集計がずれないように） */
export async function saveExpense(input: ExpenseInput, id?: string): Promise<ExpenseSaveResult> {
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力内容を確認してください", fieldErrors: toFieldErrors(parsed.error) };
  if (id !== undefined && !z.uuid().safeParse(id).success) return { ok: false, error: "経費が見つかりません" };
  const v = parsed.data;
  const today = todayJst();
  if (v.spentOn > today) return { ok: false, error: "入力内容を確認してください", fieldErrors: { spentOn: "未来の日付は登録できません" } };
  if (v.spentOn < addDays(today, -OLDEST_DAYS)) {
    return { ok: false, error: "入力内容を確認してください", fieldErrors: { spentOn: "3年以内の日付を入力してください" } };
  }
  const values = {
    spent_on: v.spentOn,
    category: v.category,
    amount: v.amount,
    driver_id: v.driverId,
    vehicle_id: v.vehicleId,
    description: v.description || null,
  };
  try {
    const result = await asAdmin(async (tx, user): Promise<ExpenseSaveResult> => {
      let row: { id: string } | undefined;
      if (id) {
        [row] = await tx<{ id: string }[]>`update expenses set ${tx(values)} where id = ${id} returning id`;
        if (!row) return { ok: false, error: "経費が見つかりません（削除された可能性があります）" };
      } else {
        [row] = await tx<{ id: string }[]>`insert into expenses ${tx({ ...values, company_id: user.companyId })} returning id`;
      }
      await tx`insert into audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
               values (${user.companyId}, ${user.userId}, ${user.displayName}, ${id ? "update" : "create"}, 'expense', ${row.id},
                       ${tx.json({ spentOn: v.spentOn, category: EXPENSE_CATEGORY_LABEL[v.category], amount: v.amount })})`;
      return { ok: true, id: row.id };
    });
    if (result.ok) revalidateExpenses();
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e) };
  }
}

export async function deleteExpense(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "経費が見つかりません" };
  try {
    const result = await asAdmin(async (tx, user) => {
      const [row] = await tx<{ spent_on: string; amount: number }[]>`delete from expenses where id = ${id} returning spent_on, amount`;
      if (!row) return { ok: false as const, error: "経費が見つかりません" };
      await tx`insert into audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
               values (${user.companyId}, ${user.userId}, ${user.displayName}, 'delete', 'expense', ${id},
                       ${tx.json({ spentOn: String(row.spent_on), amount: row.amount })})`;
      return { ok: true as const };
    });
    if (result.ok) revalidateExpenses();
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "削除に失敗しました") };
  }
}
