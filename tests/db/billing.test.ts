/**
 * DB テスト：荷主への請求（月末締め）。
 *   1. 未請求・請求済みの金額が、荷主一覧・荷主詳細・売上分析で食い違わない（売上 = 請求済み + 未請求）
 *   2. 請求の発行・取り消しのルールが DB で守られる（画面やサーバー処理を通さない更新でも崩れない）
 *   3. 他社・ドライバーからは請求を見られず、操作もできない
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { runAsUser } from "@/lib/db/rls";
import { getAnalytics, resolvePeriod } from "@/lib/data/analytics";
import { getClientBilling, getClientDetail, listClients, parseClientFilters, type BillingMonth } from "@/lib/data/clients";
import { addMonths, endOfMonth, startOfMonth, todayJst } from "@/lib/date";
import { INTEGRITY_CHECKS } from "../../scripts/seed/checks";
import { connectTyped, createTenant, dropTenant, type TestTenant } from "./helpers";

let sql: Sql;
let a: TestTenant;
let b: TestTenant;
const today = todayJst();
const thisMonth = startOfMonth(today);

beforeAll(async () => {
  sql = connectTyped();
  const now = new Date();
  a = await createTenant(sql, { seed: 707, now });
  b = await createTenant(sql, { seed: 808, now });
});

afterAll(async () => {
  await dropTenant(sql, a);
  await dropTenant(sql, b);
  await sql.end();
});

const asAdminA = <T>(fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, a.adminId, fn);
const asAdminB = <T>(fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, b.adminId, fn);
const asDriverA = <T>(fn: (tx: TransactionSql) => Promise<T>) => runAsUser(sql, a.driverUserId, fn);

/** 締め済みで未請求が残っている「荷主 × 月」を1つ探す（デモデータは直近の締め月に未請求の荷主を残している） */
async function findUnbilledMonth(): Promise<{ clientId: string; month: BillingMonth }> {
  return asAdminA(async (tx) => {
    for (const c of await listClients(tx, parseClientFilters({}), today)) {
      if (c.unbilledClosed === 0) continue;
      const billing = await getClientBilling(tx, c.id, today);
      const month = billing.months.find((m) => m.closed && m.unbilled > 0);
      if (month) return { clientId: c.id, month };
    }
    throw new Error("締め済みの未請求がデモデータにありません");
  });
}

const activeInvoices = (m: BillingMonth) => m.invoices.filter((i) => !i.cancelledAt);

describe("請求の数字が画面間で一致する", () => {
  it("荷主一覧の未請求 = 荷主詳細の未請求、各月の売上 = 請求済み + 未請求 = 売上分析", async () => {
    const { list, billings, details, monthly } = await asAdminA(async (tx) => {
      const list = await listClients(tx, parseClientFilters({}), today);
      const billings = await Promise.all(list.map((c) => getClientBilling(tx, c.id, today)));
      const details = await Promise.all(list.map((c) => getClientDetail(tx, c.id, today)));
      // 直近6か月の各月の荷主別売上（売上分析と同じ関数）
      const months = Array.from({ length: 6 }, (_, i) => startOfMonth(addMonths(today, -i)));
      const monthly = new Map<string, Awaited<ReturnType<typeof getAnalytics>>>();
      for (const m of months) {
        const to = m === thisMonth ? today : endOfMonth(m);
        monthly.set(m, await getAnalytics(tx, resolvePeriod({ period: "custom", from: m, to }, today)));
      }
      return { list, billings, details, monthly };
    });

    let unbilledTotal = 0;
    list.forEach((c, i) => {
      const billing = billings[i];
      expect([c.name, billing.unbilled, billing.unbilledClosed]).toEqual([c.name, c.unbilled, c.unbilledClosed]);
      unbilledTotal += billing.unbilled;
      expect(billing.months.length).toBeGreaterThanOrEqual(6);
      for (const m of billing.months) {
        const invoiced = activeInvoices(m).reduce((s, inv) => s + inv.amount, 0);
        expect(invoiced + m.unbilled, `${c.name} ${m.month}`).toBe(m.revenue);
        // 締め前の今月は請求が無い
        if (!m.closed) expect(m.invoices).toHaveLength(0);
        const analytics = monthly.get(m.month);
        if (analytics) {
          const row = analytics.clients.find((x) => x.clientId === c.id)!;
          expect(m.revenue, `${c.name} ${m.month}`).toBe(row.revenue);
        }
        // 荷主詳細の月別グラフとも一致する
        const bar = details[i]!.series.find((s) => s.bucket === m.month);
        if (bar) expect(m.revenue).toBe(bar.revenue);
      }
    });
    // 未請求の合計 = 配送完了・未請求の案件の料金合計（生成データから直接数える）
    const expected = a.data.orders
      .filter((o) => o.status === "delivered" && o.invoice_id === null)
      .reduce((s, o) => s + (o.fee as number), 0);
    expect(unbilledTotal).toBe(expected);
  });
});

describe("請求の発行と取り消し", () => {
  it("締め済みの月の未請求をまとめて請求済みにでき、二重には発行できない", async () => {
    const { clientId, month } = await findUnbilledMonth();
    const inv = await asAdminA(async (tx) => {
      const [row] = await tx<{ id: string; invoice_no: string; amount: number; order_count: number; period_start: string; issued_on: string }[]>`
        select * from issue_client_invoice(${clientId}, ${month.month}::date)`;
      return row;
    });
    expect(inv.amount).toBe(month.unbilled);
    expect(inv.order_count).toBe(month.unbilledCount);
    expect(inv.invoice_no).toMatch(new RegExp(`^INV-${month.month.slice(0, 4)}${month.month.slice(5, 7)}-\\d{3}$`));
    expect(inv.issued_on).toBe(today);

    const after = await asAdminA(async (tx) => {
      const billing = await getClientBilling(tx, clientId, today);
      const orders = await tx<{ n: number }[]>`select count(*)::int n from delivery_orders where invoice_id = ${inv.id} and invoiced`;
      return { m: billing.months.find((x) => x.month === month.month)!, linked: orders[0].n };
    });
    expect(after.m.unbilled).toBe(0);
    expect(after.linked).toBe(month.unbilledCount);
    expect(activeInvoices(after.m).map((i) => i.invoiceNo)).toContain(inv.invoice_no);

    await expect(asAdminA((tx) => tx`select issue_client_invoice(${clientId}, ${month.month}::date)`))
      .rejects.toThrow("請求対象の案件がありません");
  });

  it("今月（締め前）と未来の月は請求できない", async () => {
    const clientId = a.data.clients[0].id as string;
    await expect(asAdminA((tx) => tx`select issue_client_invoice(${clientId}, ${thisMonth}::date)`))
      .rejects.toThrow("締め済みの月");
    await expect(asAdminA((tx) => tx`select issue_client_invoice(${clientId}, ${addMonths(thisMonth, 1)}::date)`))
      .rejects.toThrow("締め済みの月");
  });

  it("請求済みの案件は料金・荷主・配送日を変更できない（メモなどは変更できる）", async () => {
    const order = a.data.orders.find((o) => o.invoice_id !== null)!;
    const otherClient = a.data.clients.find((c) => c.id !== order.client_id)!.id as string;
    await expect(asAdminA((tx) => tx`update delivery_orders set fee = fee + 100 where id = ${order.id as string}`))
      .rejects.toThrow("請求済みの案件は料金・荷主・配送日を変更できません");
    await expect(asAdminA((tx) => tx`update delivery_orders set client_id = ${otherClient} where id = ${order.id as string}`))
      .rejects.toThrow("請求済みの案件は料金・荷主・配送日を変更できません");
    await expect(asAdminA((tx) => tx`update delivery_orders set invoice_id = null where id = ${order.id as string}`))
      .rejects.toThrow("請求を取り消してください");
    const [updated] = await asAdminA((tx) => tx<{ notes: string }[]>`
      update delivery_orders set notes = '請求後のメモ' where id = ${order.id as string} returning notes`);
    expect(updated.notes).toBe("請求後のメモ");
  });

  it("案件を直接請求にひも付けたり、請求を直接作成・変更・削除したりはできない", async () => {
    const { clientId, month } = await findUnbilledMonth().catch(() => ({ clientId: null, month: null }));
    const invoice = a.data.invoices[0];
    if (clientId && month) {
      const [target] = await sql<{ id: string }[]>`
        select id from delivery_orders where client_id = ${clientId} and status = 'delivered' and invoice_id is null limit 1`;
      const [sameClientInvoice] = await sql<{ id: string }[]>`
        select id from client_invoices where client_id = ${clientId} and cancelled_at is null limit 1`;
      if (target && sameClientInvoice) {
        await expect(asAdminA((tx) => tx`update delivery_orders set invoice_id = ${sameClientInvoice.id} where id = ${target.id}`))
          .rejects.toThrow("「請求済みにする」から発行してください");
      }
    }
    await expect(asAdminA((tx) => tx`
      insert into client_invoices (company_id, client_id, invoice_no, period_start, period_end, order_count, amount, issued_on)
      values (${a.companyId}, ${invoice.client_id as string}, 'INV-999999-001', '2026-01-01', '2026-01-31', 1, 1, '2026-02-05')`))
      .rejects.toThrow(/permission denied/);
    await expect(asAdminA((tx) => tx`update client_invoices set amount = 1 where id = ${invoice.id as string}`))
      .rejects.toThrow(/permission denied/);
    await expect(asAdminA((tx) => tx`delete from client_invoices where id = ${invoice.id as string}`))
      .rejects.toThrow(/permission denied/);
    // メモだけは変更できる
    const [noted] = await asAdminA((tx) => tx<{ notes: string }[]>`
      update client_invoices set notes = '郵送済み' where id = ${invoice.id as string} returning notes`);
    expect(noted.notes).toBe("郵送済み");
    // 所有者の接続でも金額は変えられない（トリガーで拒否）
    await expect(sql`update client_invoices set amount = amount + 1 where id = ${invoice.id as string}`)
      .rejects.toThrow("発行済みの請求は変更できません");
  });

  it("取り消すと案件は未請求に戻り、請求は「取消」として残る。番号は再利用しない", async () => {
    const invoice = a.data.invoices.find((i) => i.period_start !== a.data.invoices[0].period_start) ?? a.data.invoices[1];
    const clientId = invoice.client_id as string;
    const month = invoice.period_start as string;
    const cancelled = await asAdminA(async (tx) => {
      const [row] = await tx<{ invoice_no: string; cancelled_at: Date | null }[]>`select * from cancel_client_invoice(${invoice.id as string})`;
      return row;
    });
    expect(cancelled.invoice_no).toBe(invoice.invoice_no);
    expect(cancelled.cancelled_at).not.toBeNull();

    const before = await asAdminA((tx) => getClientBilling(tx, clientId, today));
    const m = before.months.find((x) => x.month === month);
    if (m) {
      expect(m.unbilled).toBe(invoice.amount);
      expect(m.invoices.find((i) => i.id === invoice.id)?.cancelledAt).not.toBeNull();
    }
    await expect(asAdminA((tx) => tx`select cancel_client_invoice(${invoice.id as string})`)).rejects.toThrow("既に取り消されています");
    await expect(sql`update client_invoices set cancelled_at = null where id = ${invoice.id as string}`).rejects.toThrow("元に戻せません");

    // 発行し直すと、同じ月の最大番号の次の番号になる（取り消した番号は使わない）
    const [maxNo] = await sql<{ max: string }[]>`
      select max(invoice_no) max from client_invoices where company_id = ${a.companyId} and period_start = ${month}::date`;
    const reissued = await asAdminA(async (tx) => {
      const [row] = await tx<{ invoice_no: string; amount: number }[]>`select * from issue_client_invoice(${clientId}, ${month}::date)`;
      return row;
    });
    expect(reissued.amount).toBe(invoice.amount);
    expect(reissued.invoice_no > maxNo.max).toBe(true);
  });

  it("請求に関わる整合性チェックがすべて通る", async () => {
    for (const check of INTEGRITY_CHECKS) {
      const [{ n }] = await sql.unsafe<{ n: number }[]>(check.sql);
      expect(Number(n), check.label).toBe(0);
    }
  });
});

describe("請求の権限", () => {
  it("ドライバーは請求を見られず、発行・取り消しもできない", async () => {
    const invoice = a.data.invoices[0];
    const rows = await asDriverA((tx) => tx`select id from client_invoices`);
    expect(rows).toHaveLength(0);
    await expect(asDriverA((tx) => tx`select issue_client_invoice(${invoice.client_id as string}, ${invoice.period_start as string}::date)`))
      .rejects.toThrow("管理者のみ操作できます");
    await expect(asDriverA((tx) => tx`select cancel_client_invoice(${invoice.id as string})`))
      .rejects.toThrow("管理者のみ操作できます");
  });

  it("他社の請求は見えず、他社の荷主・請求は操作できない", async () => {
    const invoice = a.data.invoices[0];
    const rows = await asAdminB((tx) => tx`select id from client_invoices where company_id = ${a.companyId}`);
    expect(rows).toHaveLength(0);
    await expect(asAdminB((tx) => tx`select issue_client_invoice(${invoice.client_id as string}, ${invoice.period_start as string}::date)`))
      .rejects.toThrow("荷主が見つかりません");
    await expect(asAdminB((tx) => tx`select cancel_client_invoice(${invoice.id as string})`))
      .rejects.toThrow("請求が見つかりません");
    const billing = await asAdminB((tx) => getClientBilling(tx, invoice.client_id as string, today));
    expect(billing.unbilled).toBe(0);
    expect(billing.months.every((m) => m.revenue === 0 && m.invoices.length === 0)).toBe(true);
  });
});
