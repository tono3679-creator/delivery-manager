import "server-only";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { AUDIT_FILTERS, type AuditFilterKey, type AuditRow } from "@/lib/domain/audit";

export type CompanySettings = {
  name: string;
  isDemo: boolean;
  demoExpiresAt: Date | null;
  /** デモが自動で削除されるまでの時間（切り上げ。デモでなければ null） */
  demoHoursLeft: number | null;
};

/** ログイン中の会社（RLS で自社の1行だけ見える） */
export async function getCompanySettings(tx: Tx): Promise<CompanySettings | null> {
  const [row] = await tx<{ name: string; is_demo: boolean; demo_expires_at: Date | null; hours_left: number | null }[]>`
    select name, is_demo, demo_expires_at,
           greatest(0, ceil(extract(epoch from demo_expires_at - now()) / 3600))::int hours_left
      from companies limit 1`;
  return row
    ? { name: row.name, isDemo: row.is_demo, demoExpiresAt: row.demo_expires_at, demoHoursLeft: row.hours_left }
    : null;
}

export type OfficeRow = {
  id: string;
  name: string;
  address: string;
  /** 所属ドライバー（退職者を除く） */
  drivers: number;
  /** 所属ドライバーの記録（退職者を含む）。1人でもいれば削除できない */
  allDrivers: number;
};

export async function listOffices(tx: Tx): Promise<OfficeRow[]> {
  const rows = await tx<{ id: string; name: string; address: string; drivers: number; all_drivers: number }[]>`
    select o.id, o.name, o.address,
           count(d.id) filter (where d.status <> 'retired')::int drivers,
           count(d.id)::int all_drivers
      from offices o
      left join drivers d on d.office_id = o.id
     group by o.id
     order by o.created_at, o.name`;
  return rows.map((r) => ({ id: r.id, name: r.name, address: r.address, drivers: r.drivers, allDrivers: r.all_drivers }));
}

export const AUDIT_PAGE_SIZE = 20;

const auditParams = z.object({
  log: z.enum(AUDIT_FILTERS.map((f) => f.key) as [AuditFilterKey, ...AuditFilterKey[]]).catch(""),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
export type AuditParams = z.infer<typeof auditParams>;

export function parseAuditParams(params: Record<string, string | string[] | undefined>): AuditParams {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return auditParams.parse({ log: flat.log ?? "", page: flat.page ?? 1 });
}

/** 操作履歴（新しい順・1ページ 20 件）。名前は detail の ID から引く */
export async function listAuditLogs(tx: Tx, p: AuditParams): Promise<{ rows: AuditRow[]; total: number; page: number; pageCount: number }> {
  const entities = [...(AUDIT_FILTERS.find((f) => f.key === p.log)?.entities ?? [])];
  const where = entities.length > 0 ? tx`where l.entity in ${tx(entities)}` : tx``;
  const [{ total }] = await tx<{ total: number }[]>`select count(*)::int total from audit_logs l ${where}`;
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(p.page, pageCount);
  const rows = await tx<{
    id: string; created_at: Date; actor_name: string | null; action: string; entity: string; entity_id: string | null;
    detail: Record<string, unknown> | null; to_driver: string | null; from_driver: string | null; client_name: string | null;
    target_exists: boolean;
  }[]>`
    select l.id, l.created_at, l.actor_name, l.action, l.entity, l.entity_id, l.detail,
           td.name to_driver, fd.name from_driver, c.name client_name,
           case l.entity
             when 'delivery_order' then exists (select 1 from delivery_orders x where x.id = l.entity_id)
             when 'driver' then exists (select 1 from drivers x where x.id = l.entity_id)
             when 'vehicle' then exists (select 1 from vehicles x where x.id = l.entity_id)
             when 'client' then exists (select 1 from clients x where x.id = l.entity_id)
             when 'client_invoice' then exists (select 1 from client_invoices x where x.id = l.entity_id)
             else false
           end target_exists
      from audit_logs l
      left join drivers td on td.id::text = l.detail ->> 'toDriverId'
      left join drivers fd on fd.id::text = l.detail ->> 'fromDriverId'
      left join clients c on c.id::text = l.detail ->> 'clientId'
      ${where}
     order by l.created_at desc, l.id
     limit ${AUDIT_PAGE_SIZE} offset ${(page - 1) * AUDIT_PAGE_SIZE}`;
  return {
    rows: rows.map((r) => ({
      id: r.id,
      at: r.created_at,
      actorName: r.actor_name,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      detail: r.detail && typeof r.detail === "object" && !Array.isArray(r.detail) ? r.detail : null,
      toDriverName: r.to_driver,
      fromDriverName: r.from_driver,
      clientName: r.client_name,
      targetExists: r.target_exists,
    })),
    total,
    page,
    pageCount,
  };
}
