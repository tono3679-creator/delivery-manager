"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FormOptions } from "@/lib/data/orders";
import type { OrderStatus } from "@/lib/domain/status";
import { DELETABLE_STATUSES } from "@/lib/domain/status";
import type { OrderFormInput } from "@/lib/validation/order";
import { DeleteOrderDialog } from "./delete-order-dialog";
import { OrderFormDialog } from "./order-form-dialog";

/** 案件詳細の「編集」「削除」。一覧の「編集する」から来たとき（?edit=1）は編集を開いた状態で表示する */
export function OrderDetailActions({
  orderId, orderNo, status, options, initial, editOnOpen, invoiceNo,
}: {
  orderId: string; orderNo: string; status: OrderStatus; options: FormOptions; initial: OrderFormInput; editOnOpen: boolean;
  /** 請求済みなら請求番号（荷主と料金を変更できない） */
  invoiceNo?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [editing, setEditing] = useState(editOnOpen);
  // 開くたびに最新の内容でフォームを作り直す（編集中に画面が更新されても入力は消えない）
  const [formKey, setFormKey] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const lock = status === "delivered" || status === "cancelled" ? "schedule" : status === "picked_up" || status === "in_transit" ? "driver" : undefined;

  return (
    <>
      <Button variant="outline" onClick={() => { setFormKey((k) => k + 1); setEditing(true); }}>
        <Pencil aria-hidden />
        編集
      </Button>
      {DELETABLE_STATUSES.includes(status) && (
        <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleting(true)}>
          <Trash2 aria-hidden />
          削除
        </Button>
      )}
      <OrderFormDialog
        key={formKey}
        open={editing}
        onOpenChange={(open) => {
          setEditing(open);
          // ?edit=1 を消して、再読み込みで再び開かないようにする
          if (!open && editOnOpen) router.replace(pathname, { scroll: false });
        }}
        options={options}
        initial={initial}
        orderId={orderId}
        orderNo={orderNo}
        lock={lock}
        invoiceNo={invoiceNo ?? undefined}
      />
      <DeleteOrderDialog open={deleting} onOpenChange={setDeleting} orderId={orderId} orderNo={orderNo} redirectTo="/orders" />
    </>
  );
}
