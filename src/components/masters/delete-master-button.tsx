"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteClient, deleteDriver, deleteVehicle } from "@/lib/actions/masters";

const ACTIONS = { driver: deleteDriver, vehicle: deleteVehicle, client: deleteClient } as const;
const NOTE = {
  driver: "配送実績のあるドライバーは削除できません。辞めた方は「退職」にすると、履歴を残したまま配車の候補から外れます。",
  vehicle: "案件や経費の記録がある車両は削除できません。使わなくなった車両は「廃車」にしてください。",
  client: "案件がある荷主は、売上の履歴を残すため削除できません。",
} as const;

/** マスタの削除。実績がある場合はサーバーが拒否し、その理由を表示する */
export function DeleteMasterButton({
  kind, id, name, redirectTo, disabledReason,
}: { kind: keyof typeof ACTIONS; id: string; name: string; redirectTo: string; disabledReason?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const onDelete = async () => {
    setPending(true);
    const result = await ACTIONS[kind](id);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      setOpen(false);
      return;
    }
    toast.success(`${name} を削除しました`);
    setOpen(false);
    router.push(redirectTo);
  };
  return (
    <>
      <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setOpen(true)} title={disabledReason}>
        <Trash2 aria-hidden />
        削除
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{name} を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {disabledReason ?? `${NOTE[kind]} 削除すると元に戻せません。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{disabledReason ? "閉じる" : "やめる"}</AlertDialogCancel>
            {!disabledReason && (
              <Button variant="destructive" onClick={onDelete} disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                削除する
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
