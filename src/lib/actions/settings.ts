"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { asAdmin, type CurrentUser } from "@/lib/auth";
import type { Tx } from "@/lib/db";
import { approximateLocation } from "@/lib/domain/location";
import { companySchema, officeSchema, type CompanyInput, type OfficeInput } from "@/lib/validation/settings";
import { toFieldErrors, toUserMessage } from "./errors";

export type SettingsResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function audit(tx: Tx, user: CurrentUser, action: string, entity: string, id: string | null, detail: Record<string, unknown>) {
  return tx`insert into audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
            values (${user.companyId}, ${user.userId}, ${user.displayName}, ${action}, ${entity}, ${id}, ${tx.json(detail as never)})`;
}

/** 会社名の変更（会社の行で変更できるのは名前だけ。デモの期限などは DB の権限で変更できない） */
export async function updateCompanyName(input: CompanyInput): Promise<SettingsResult> {
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力内容を確認してください", fieldErrors: toFieldErrors(parsed.error) };
  const { name } = parsed.data;
  try {
    const result = await asAdmin(async (tx, user): Promise<SettingsResult> => {
      const [before] = await tx<{ name: string }[]>`select name from companies where id = ${user.companyId} for update`;
      if (!before) return { ok: false, error: "会社が見つかりません" };
      if (before.name === name) return { ok: true };
      await tx`update companies set name = ${name} where id = ${user.companyId}`;
      await audit(tx, user, "update", "company", user.companyId, { from: before.name, to: name });
      return { ok: true };
    });
    // 会社名はサイドバー・ヘッダーにも出る
    if (result.ok) revalidatePath("/", "layout");
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e) };
  }
}

/** 営業所の登録・更新。地図用の位置は住所からおおよそで決める */
export async function saveOffice(input: OfficeInput, id?: string): Promise<SettingsResult> {
  const parsed = officeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "入力内容を確認してください", fieldErrors: toFieldErrors(parsed.error) };
  if (id !== undefined && !z.uuid().safeParse(id).success) return { ok: false, error: "営業所が見つかりません" };
  const v = parsed.data;
  const loc = approximateLocation(v.address);
  const values = { name: v.name, address: v.address, lat: loc?.lat ?? null, lng: loc?.lng ?? null };
  try {
    const result = await asAdmin(async (tx, user): Promise<SettingsResult> => {
      const [dup] = await tx`select 1 from offices where name = ${v.name} and (${id ?? null}::uuid is null or id <> ${id ?? null}::uuid)`;
      if (dup) return { ok: false, error: "同じ名前の営業所があります", fieldErrors: { name: "同じ名前の営業所があります" } };
      let rowId: string;
      if (id) {
        const [row] = await tx<{ id: string }[]>`update offices set ${tx(values)} where id = ${id} returning id`;
        if (!row) return { ok: false, error: "営業所が見つかりません（削除された可能性があります）" };
        rowId = row.id;
      } else {
        const [row] = await tx<{ id: string }[]>`insert into offices ${tx({ ...values, company_id: user.companyId })} returning id`;
        rowId = row.id;
      }
      await audit(tx, user, id ? "update" : "create", "office", rowId, { name: v.name, address: v.address });
      return { ok: true };
    });
    if (result.ok) {
      revalidatePath("/settings");
      revalidatePath("/drivers", "layout");
    }
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e) };
  }
}

/** 削除できるのは、所属ドライバー（退職者を含む）がいない営業所だけ */
export async function deleteOffice(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "営業所が見つかりません" };
  try {
    const result = await asAdmin(async (tx, user): Promise<{ ok: true } | { ok: false; error: string }> => {
      const [o] = await tx<{ name: string; drivers: number }[]>`
        select name, (select count(*)::int from drivers d where d.office_id = o.id) drivers
          from offices o where id = ${id} for update`;
      if (!o) return { ok: false, error: "営業所が見つかりません" };
      if (o.drivers > 0) {
        return { ok: false, error: `所属しているドライバー（${o.drivers}名）がいるため削除できません。先にドライバーの所属営業所を変更してください` };
      }
      await tx`delete from offices where id = ${id}`;
      await audit(tx, user, "delete", "office", id, { name: o.name });
      return { ok: true };
    });
    if (result.ok) {
      revalidatePath("/settings");
      revalidatePath("/drivers", "layout");
    }
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "削除に失敗しました") };
  }
}
