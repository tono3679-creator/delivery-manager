"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { changeOrderStatus } from "@/lib/actions/orders";
import { assignOrder } from "@/lib/actions/dispatch";
import { CANCEL_REASONS, FAILURE_REASONS } from "@/lib/domain/reasons";
import { adminActions, ORDER_STATUS_LABEL, type AdminAction, type OrderStatus } from "@/lib/domain/status";
import { safeAction } from "@/lib/client/safe-action";

/** 案件詳細のステータス操作。画面に表示中のステータスを送り、DB 側で一致を確認してから更新する */
export function StatusActions({
  orderId, status, driverId,
}: { orderId: string; status: OrderStatus; driverId: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<Extract<AdminAction, { kind: "status" }> | null>(null);
  const [note, setNote] = useState("");
  const actions = adminActions(status);

  const run = async (action: AdminAction, withNote?: string) => {
    setPending(action.label);
    const result = action.kind === "unassign"
      ? await safeAction(() => assignOrder({ orderId, driverId: null, expectedStatus: status, expectedDriverId: driverId }))
      : await safeAction(() => changeOrderStatus({ orderId, expected: status, to: action.to, note: withNote }));
    setPending(null);
    if (result.ok) {
      toast.success(action.kind === "unassign" ? "配車を解除しました" : `「${ORDER_STATUS_LABEL[action.to]}」に変更しました`);
      setNoteFor(null);
      setNote("");
    } else if ("error" in result) {
      toast.error(result.error);
    }
    router.refresh();
  };

  if (actions.length === 0) {
    return <p className="text-sm text-muted-foreground">この案件は{ORDER_STATUS_LABEL[status]}のため、ステータスは変更できません。</p>;
  }

  return (
    <>
      <div className="grid gap-2">
        {actions.map((a) => (
          <Button
            key={a.label}
            variant={a.tone === "primary" ? "default" : "outline"}
            className={a.tone === "danger" ? "text-destructive hover:text-destructive" : undefined}
            disabled={pending !== null}
            onClick={() => (a.kind === "status" && a.requiresNote ? setNoteFor(a) : run(a))}
          >
            {pending === a.label && <Loader2 className="animate-spin" aria-hidden />}
            {a.label}
          </Button>
        ))}
      </div>

      <Dialog open={noteFor !== null} onOpenChange={(o) => !o && setNoteFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{noteFor?.to === "cancelled" ? "キャンセルの理由" : "配送失敗の理由"}</DialogTitle>
            <DialogDescription>理由はステータス履歴に残り、ドライバーや他の管理者も確認できます。</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (noteFor && note.trim()) run(noteFor, note.trim());
            }}
          >
            {noteFor && (
              <div className="flex flex-wrap gap-1.5" aria-label="よく使う理由">
                {(noteFor.to === "cancelled" ? CANCEL_REASONS : FAILURE_REASONS).map((r) => (
                  <button key={r} type="button" onClick={() => setNote(r)}
                    className="rounded-full border bg-card px-3 py-1 text-xs hover:bg-accent aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                    aria-pressed={note === r}>{r}</button>
                ))}
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="status-note">理由<span className="text-xs text-destructive">必須</span></Label>
              <Textarea id="status-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNoteFor(null)}>やめる</Button>
              <Button type="submit" variant="destructive" disabled={!note.trim() || pending !== null}>
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                {noteFor?.to === "cancelled" ? "キャンセルする" : "配送失敗にする"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
