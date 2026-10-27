"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileCheck2, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cancelInvoice, issueInvoice } from "@/lib/actions/billing";
import { formatNumber, formatYen } from "@/lib/format";

type ConfirmProps = {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  run: () => Promise<{ ok: true } | { ok: false; error: string }>;
  success: string;
  trigger: (open: () => void) => React.ReactNode;
};

function ConfirmAction({ title, description, confirmLabel, destructive, run, success, trigger }: ConfirmProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const onConfirm = async () => {
    setPending(true);
    const result = await run();
    setPending(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.error);
      router.refresh();
      return;
    }
    toast.success(success);
    router.refresh();
  };
  return (
    <>
      {trigger(() => setOpen(true))}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription asChild><div className="space-y-2">{description}</div></AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>やめる</AlertDialogCancel>
            <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** 締め済みの月の未請求分を請求済みにする。金額と件数はサーバーが発行時点で数え直す */
export function IssueInvoiceButton({ clientId, clientName, month, monthLabel, amount, count }: {
  clientId: string; clientName: string; month: string; monthLabel: string; amount: number; count: number;
}) {
  return (
    <ConfirmAction
      title={`${monthLabel}分を請求済みにしますか？`}
      description={
        <>
          <p>{clientName}の{monthLabel}の配送完了・未請求の案件をまとめて請求番号を振ります。</p>
          <p className="font-medium text-foreground tabular">{formatNumber(count, "件")}・{formatYen(amount)}</p>
          <p>請求済みにした案件は、料金・荷主・配送日を変更できなくなります（請求を取り消すと元に戻せます）。</p>
        </>
      }
      confirmLabel="請求済みにする"
      run={() => issueInvoice({ clientId, month })}
      success={`${monthLabel}分を請求済みにしました`}
      trigger={(open) => (
        <Button size="sm" variant="outline" onClick={open} className="whitespace-nowrap">
          <FileCheck2 aria-hidden />
          請求済みにする
        </Button>
      )}
    />
  );
}

/** 請求の取り消し。請求は「取消」として残り、含まれていた案件は未請求に戻る */
export function CancelInvoiceButton({ invoiceId, invoiceNo, amount, count }: { invoiceId: string; invoiceNo: string; amount: number; count: number }) {
  return (
    <ConfirmAction
      title={`請求 ${invoiceNo} を取り消しますか？`}
      description={
        <>
          <p className="tabular">{formatNumber(count, "件")}・{formatYen(amount)} の案件が未請求に戻ります。</p>
          <p>金額の誤りなどで請求書を出し直すときに使います。取り消した請求は履歴に「取消」として残り、請求番号は再利用されません。</p>
        </>
      }
      confirmLabel="取り消す"
      destructive
      run={() => cancelInvoice(invoiceId)}
      success={`請求 ${invoiceNo} を取り消しました`}
      trigger={(open) => (
        <Button size="icon" variant="ghost" onClick={open} className="size-7 text-muted-foreground" aria-label={`請求 ${invoiceNo} を取り消す`} title="請求を取り消す">
          <Undo2 aria-hidden />
        </Button>
      )}
    />
  );
}
