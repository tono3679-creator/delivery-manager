"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteOrder } from "@/lib/actions/orders";

/** 削除の確認。削除後に移動する先を指定できる（詳細画面からは一覧へ戻る） */
export function DeleteOrderDialog({
  open, onOpenChange, orderId, orderNo, redirectTo,
}: { open: boolean; onOpenChange: (open: boolean) => void; orderId: string; orderNo: string; redirectTo?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const onDelete = async () => {
    setPending(true);
    const result = await deleteOrder(orderId);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${orderNo} を削除しました`);
    onOpenChange(false);
    if (redirectTo) router.push(redirectTo);
    else router.refresh();
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{orderNo} を削除しますか？</AlertDialogTitle>
          <AlertDialogDescription>
            ステータス履歴やメモも含めて削除され、元に戻せません。記録を残したい場合は「キャンセル」に変更してください。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>やめる</AlertDialogCancel>
          <Button variant="destructive" onClick={onDelete} disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            削除する
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
