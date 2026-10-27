"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignVehicle } from "@/lib/actions/masters";

const NONE = "__none";

/** takenBy … 選ぶと担当が外れる相手（今の担当者・今の車両） / note … 選べない理由など */
export type AssignOption = { id: string; label: string; takenBy?: string | null; note?: string | null; disabled?: boolean };

/**
 * 担当車両の変更。ドライバー詳細（車両を選ぶ）と車両詳細（ドライバーを選ぶ）の両方から使う。
 * 選んだ相手に別の担当があれば、そちらは今日で終了する。
 */
export function AssignVehicleButton({
  mode, fixedId, currentId, options, label = "担当を変更",
}: {
  /** "driver"：ドライバー詳細から車両を選ぶ / "vehicle"：車両詳細からドライバーを選ぶ */
  mode: "driver" | "vehicle";
  fixedId: string;
  currentId: string | null;
  options: AssignOption[];
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentId ?? NONE);
  const [pending, setPending] = useState(false);
  const selected = options.find((o) => o.id === value);

  const onSave = async () => {
    const target = value === NONE ? null : value;
    let input: { vehicleId: string; driverId: string | null };
    if (mode === "vehicle") input = { vehicleId: fixedId, driverId: target };
    else if (target) input = { vehicleId: target, driverId: fixedId };
    else if (currentId) input = { vehicleId: currentId, driverId: null };
    else return setOpen(false);
    setPending(true);
    const result = await assignVehicle(input);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(target ? "担当を変更しました" : "担当を外しました");
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setValue(currentId ?? NONE); setOpen(true); }}>
        <ArrowLeftRight aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{mode === "driver" ? "担当車両を変更" : "担当ドライバーを変更"}</DialogTitle>
            <DialogDescription>
              今日から新しい担当になり、履歴に残ります。既に割り当て済みの案件の車両は変わりません。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="assign-target">{mode === "driver" ? "車両" : "ドライバー"}</Label>
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger id="assign-target"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>担当なし</SelectItem>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id} disabled={o.disabled}>
                    {o.label}
                    {(o.note || o.takenBy) && (
                      <span className="text-muted-foreground">（{o.note ?? (mode === "driver" ? `${o.takenBy}が担当中` : `${o.takenBy}を担当中`)}）</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected?.takenBy && (
              <p className="text-xs text-warning-strong">
                {mode === "driver" ? `${selected.takenBy}の担当は今日で終了します。` : `今の車両（${selected.takenBy}）の担当は今日で終了します。`}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
            <Button onClick={onSave} disabled={pending || value === (currentId ?? NONE)}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              変更する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
