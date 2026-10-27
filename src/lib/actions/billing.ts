"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { asAdmin } from "@/lib/auth";
import { startOfMonth, todayJst } from "@/lib/date";
import { toUserMessage } from "./errors";

export type BillingActionResult = { ok: true; invoiceNo: string; amount: number; orderCount: number } | { ok: false; error: string };

const issueSchema = z.object({
  clientId: z.uuid("荷主が見つかりません"),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "対象月が正しくありません"),
});

function revalidateBilling(clientId: string) {
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/orders", "layout");
}

/**
 * 締め済みの月の、配送完了・未請求の案件をまとめて請求済みにする。
 * 対象の集計・請求番号の採番・案件のひも付けは DB の issue_client_invoice() が1つのトランザクションで行う。
 */
export async function issueInvoice(input: z.input<typeof issueSchema>): Promise<BillingActionResult> {
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "入力内容を確認してください" };
  const { clientId, month } = parsed.data;
  if (month >= startOfMonth(todayJst())) return { ok: false, error: "請求できるのは締め済みの月（前月以前）だけです" };
  try {
    const result = await asAdmin(async (tx, user): Promise<BillingActionResult> => {
      const [inv] = await tx<{ id: string; invoice_no: string; amount: number; order_count: number }[]>`
        select id, invoice_no, amount, order_count from issue_client_invoice(${clientId}, ${month}::date)`;
      await tx`insert into audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
               values (${user.companyId}, ${user.userId}, ${user.displayName}, 'issue', 'client_invoice', ${inv.id},
                       ${tx.json({ invoiceNo: inv.invoice_no, clientId, month, amount: inv.amount, orderCount: inv.order_count })})`;
      return { ok: true, invoiceNo: inv.invoice_no, amount: inv.amount, orderCount: inv.order_count };
    });
    if (result.ok) revalidateBilling(clientId);
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "請求の発行に失敗しました。時間をおいて再度お試しください") };
  }
}

/** 請求を取り消す。請求は「取消」として残り、含まれていた案件は未請求に戻る（DB の cancel_client_invoice()） */
export async function cancelInvoice(invoiceId: string): Promise<BillingActionResult> {
  if (!z.uuid().safeParse(invoiceId).success) return { ok: false, error: "請求が見つかりません" };
  try {
    const result = await asAdmin(async (tx, user) => {
      const [inv] = await tx<{ client_id: string; invoice_no: string; amount: number; order_count: number }[]>`
        select client_id, invoice_no, amount, order_count from cancel_client_invoice(${invoiceId})`;
      await tx`insert into audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
               values (${user.companyId}, ${user.userId}, ${user.displayName}, 'cancel', 'client_invoice', ${invoiceId},
                       ${tx.json({ invoiceNo: inv.invoice_no, clientId: inv.client_id, amount: inv.amount, orderCount: inv.order_count })})`;
      return inv;
    });
    revalidateBilling(result.client_id);
    return { ok: true, invoiceNo: result.invoice_no, amount: result.amount, orderCount: result.order_count };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "請求の取り消しに失敗しました。時間をおいて再度お試しください") };
  }
}
