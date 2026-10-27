"use client";
import { useState } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { CircleCheckBig, CircleX, Loader2, PackageCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSyncState } from "@/components/realtime/realtime-refresher";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { driverUpdateStatus } from "@/lib/actions/driver";
import { FAILURE_REASONS } from "@/lib/domain/reasons";
import { driverActions, type OrderStatus } from "@/lib/domain/status";
import { cn } from "@/lib/utils";

const ICON: Partial<Record<OrderStatus, typeof Truck>> = {
  picked_up: PackageCheck,
  in_transit: Truck,
  delivered: CircleCheckBig,
  failed: CircleX,
};

/**
 * ドライバーのステータス操作ボタン。片手で押せる大きさにし、取り消せない「配送完了」は確認を挟む。
 * 画面に表示していたステータスを一緒に送るため、二度押しや別端末での操作と重なっても二重に進まない。
 */
export function DriverStatusActions({ orderId, orderNo, status }: { orderId: string; orderNo: string; status: OrderStatus }) {
  const router = useRouter();
  const [pending, setPending] = useState<OrderStatus | null>(null);
  const [confirmDone, setConfirmDone] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const [note, setNote] = useState("");
  const actions = driverActions(status);
  // 通信できないときは押せないようにする（送れなかった操作が完了したように見えないように）
  const { online } = useSyncState();

  const run = async (to: OrderStatus, withNote?: string) => {
    setPending(to);
    try {
      const result = await driverUpdateStatus({ orderId, expected: status, to, note: withNote });
      if (result.ok) {
        toast.success(
          to === "picked_up" ? "集荷完了にしました" : to === "in_transit" ? "配送を開始しました" : to === "delivered" ? "配送完了にしました。おつかれさまです" : "配送失敗として報告しました",
          { description: orderNo },
        );
        setConfirmDone(false);
        setFailOpen(false);
        setNote("");
      } else {
        toast.error(result.error);
      }
    } catch (e) {
      unstable_rethrow(e);
      // 通信できないときはサーバーに届いていない。表示は変えずに再操作してもらう
      toast.error("通信できませんでした。電波の良い場所でもう一度お試しください");
    } finally {
      setPending(null);
      router.refresh();
    }
  };

  if (actions.length === 0) return null;

  return (
    <>
      <div className={cn("grid gap-2", actions.length > 1 && "grid-cols-[1fr_auto]")}>
        {actions.map((a) => {
          const Icon = ICON[a.to] ?? Truck;
          const isFail = a.to === "failed";
          return (
            <Button
              key={a.to}
              size="xl"
              variant={isFail ? "outline" : a.to === "delivered" ? "success" : "brand"}
              className={cn(isFail && "px-4 text-destructive hover:text-destructive")}
              disabled={pending !== null || !online}
              onClick={() => (a.to === "delivered" ? setConfirmDone(true) : isFail ? setFailOpen(true) : run(a.to))}
            >
              {pending === a.to ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Icon className="size-5" aria-hidden />}
              {a.label}
            </Button>
          );
        })}
      </div>
      {!online && (
        <p className="mt-2 text-center text-xs text-warning-strong" role="status">
          通信できないため、ステータスを更新できません。電波の良い場所で、通信が戻ってから操作してください。
        </p>
      )}

      <AlertDialog open={confirmDone} onOpenChange={setConfirmDone}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>配送完了にしますか？</AlertDialogTitle>
            <AlertDialogDescription>{orderNo} を配送完了にします。完了後は取り消せません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending !== null}>戻る</AlertDialogCancel>
            <Button variant="success" size="lg" disabled={pending !== null || !online} onClick={() => run("delivered")}>
              {pending === "delivered" && <Loader2 className="animate-spin" aria-hidden />}
              配送完了にする
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={failOpen} onOpenChange={setFailOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>配送失敗の報告</DialogTitle>
            <DialogDescription>理由は管理者へ通知され、再配達の手配に使われます。</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) run("failed", note.trim());
            }}
          >
            <div className="grid gap-2" role="group" aria-label="よくある理由">
              {FAILURE_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={note === r}
                  onClick={() => setNote(r)}
                  className="min-h-11 rounded-lg border bg-card px-3 py-2 text-left text-sm hover:bg-accent aria-pressed:border-destructive aria-pressed:bg-danger-soft aria-pressed:text-danger-strong"
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fail-note">理由（自由入力）<span className="text-xs text-destructive">必須</span></Label>
              <Textarea id="fail-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setFailOpen(false)}>戻る</Button>
              <Button type="submit" variant="destructive" size="lg" disabled={!note.trim() || pending !== null || !online}>
                {pending === "failed" && <Loader2 className="animate-spin" aria-hidden />}
                配送失敗として報告
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
