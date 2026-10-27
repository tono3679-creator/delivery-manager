"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { resetDemo } from "@/lib/actions/session";
import { unstable_rethrow } from "next/navigation";

/** デモデータを初期状態に戻す（確認してから実行する） */
export function DemoResetButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const onReset = () =>
    startTransition(async () => {
      const id = toast.loading("デモデータを初期化しています…");
      try {
        await resetDemo();
        toast.success("デモデータを初期状態に戻しました", { id });
        setOpen(false);
      } catch (e) {
      unstable_rethrow(e);
        toast.error("初期化できませんでした。時間をおいて再度お試しください", { id });
      }
    });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden />
        デモデータを初期化
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>デモデータを初期状態に戻しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              登録・変更した案件やマスタはすべて元に戻り、現在の時刻に合わせたデータを作り直します。有効期限も今から24時間に延びます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>やめる</AlertDialogCancel>
            <Button onClick={onReset} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              初期化する
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
