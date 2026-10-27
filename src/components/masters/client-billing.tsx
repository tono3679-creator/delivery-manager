import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CancelInvoiceButton, IssueInvoiceButton } from "@/components/masters/billing-actions";
import type { BillingInvoice, BillingMonth } from "@/lib/data/clients";
import { formatDateShort, formatNumber, formatYen } from "@/lib/format";
import { cn } from "@/lib/utils";

export function monthLabel(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}

function MonthState({ m }: { m: BillingMonth }) {
  if (!m.closed) return <Badge variant="neutral">締め前</Badge>;
  if (m.unbilled > 0) return <Badge variant="warning">未請求あり</Badge>;
  if (m.invoices.some((i) => !i.cancelledAt)) return <Badge variant="success">請求済</Badge>;
  return <Badge variant="neutral">取引なし</Badge>;
}

function InvoiceLine({ inv }: { inv: BillingInvoice }) {
  const cancelled = inv.cancelledAt !== null;
  return (
    <li className="flex items-center gap-1.5">
      <div className={cn("min-w-0 leading-tight", cancelled && "text-muted-foreground")}>
        <div className="flex items-center gap-1.5">
          <span className={cn("text-xs font-medium tabular whitespace-nowrap", cancelled && "line-through")}>{inv.invoiceNo}</span>
          {cancelled && <Badge variant="neutral" className="px-1.5 py-0">取消</Badge>}
        </div>
        <div className="text-xs tabular whitespace-nowrap text-muted-foreground">
          {formatDateShort(inv.issuedOn)}発行・<span className={cn(cancelled && "line-through")}>{formatYen(inv.amount)}</span>
        </div>
      </div>
      {!cancelled && <CancelInvoiceButton invoiceId={inv.id} invoiceNo={inv.invoiceNo} amount={inv.amount} count={inv.orderCount} />}
    </li>
  );
}

function UnbilledAmount({ m }: { m: BillingMonth }) {
  if (m.unbilled === 0) return <span className="text-muted-foreground tabular">{formatYen(0)}</span>;
  return (
    <span className={cn("tabular whitespace-nowrap", m.closed && "font-semibold text-warning-strong")}>
      {formatYen(m.unbilled)}
      <span className="block text-xs font-normal text-muted-foreground">{formatNumber(m.unbilledCount, "件")}</span>
    </span>
  );
}

function MonthAction({ m, clientId, clientName }: { m: BillingMonth; clientId: string; clientName: string }) {
  if (m.closed && m.unbilled > 0) {
    return (
      <IssueInvoiceButton clientId={clientId} clientName={clientName} month={m.month} monthLabel={monthLabel(m.month)}
        amount={m.unbilled} count={m.unbilledCount} />
    );
  }
  if (!m.closed && m.delivered > 0) return <span className="text-xs text-muted-foreground whitespace-nowrap">月末に締め</span>;
  return null;
}

/**
 * 荷主詳細の「請求・取引履歴」。月ごとに売上・請求・未請求を並べる。
 * 売上 ＝ 請求済み（取消を除く）＋ 未請求。
 */
export function ClientBillingTable({ months, clientId, clientName }: { months: BillingMonth[]; clientId: string; clientName: string }) {
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">対象月</TableHead>
              <TableHead className="text-right">配送完了</TableHead>
              <TableHead className="text-right">売上</TableHead>
              <TableHead>請求</TableHead>
              <TableHead className="text-right">未請求</TableHead>
              <TableHead className="w-36 pr-5"><span className="sr-only">操作</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) => (
              <TableRow key={m.month} className="align-top">
                <TableCell className="pl-5">
                  <div className="font-medium whitespace-nowrap">{monthLabel(m.month)}</div>
                  <div className="mt-1"><MonthState m={m} /></div>
                </TableCell>
                <TableCell className="text-right tabular whitespace-nowrap">{formatNumber(m.delivered, "件")}</TableCell>
                <TableCell className="text-right tabular whitespace-nowrap">{formatYen(m.revenue)}</TableCell>
                <TableCell>
                  {m.invoices.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <ul className="space-y-1.5">{m.invoices.map((inv) => <InvoiceLine key={inv.id} inv={inv} />)}</ul>
                  )}
                </TableCell>
                <TableCell className="text-right"><UnbilledAmount m={m} /></TableCell>
                <TableCell className="pr-5 text-right"><MonthAction m={m} clientId={clientId} clientName={clientName} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="divide-y md:hidden">
        {months.map((m) => (
          <li key={m.month} className="space-y-2 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{monthLabel(m.month)}</span>
                <MonthState m={m} />
              </div>
              <span className="text-sm tabular">{formatYen(m.revenue)}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>配送完了 {formatNumber(m.delivered, "件")}</span>
              <span>
                未請求 <span className={cn("tabular", m.closed && m.unbilled > 0 && "font-semibold text-warning-strong")}>{formatYen(m.unbilled)}</span>
              </span>
            </div>
            {m.invoices.length > 0 && <ul className="space-y-1.5">{m.invoices.map((inv) => <InvoiceLine key={inv.id} inv={inv} />)}</ul>}
            {m.closed && m.unbilled > 0 && <MonthAction m={m} clientId={clientId} clientName={clientName} />}
          </li>
        ))}
      </ul>
    </>
  );
}
