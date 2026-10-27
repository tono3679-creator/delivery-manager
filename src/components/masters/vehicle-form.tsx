"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/form-field";
import { saveVehicle } from "@/lib/actions/masters";
import { VEHICLE_STATUSES, VEHICLE_STATUS_LABEL } from "@/lib/domain/labels";
import { vehicleSchema, type VehicleInput, type VehicleValues } from "@/lib/validation/master";
import { safeAction } from "@/lib/client/safe-action";

/**
 * 車両の登録・編集ボタン。
 * activeOrders … この車両を使う対応中の案件数。1件以上なら整備中・廃車を選べない（サーバーと DB でも拒否する）。
 */
export function VehicleFormButton({
  initial, id, code, activeOrders = 0, variant = "new",
}: { initial: VehicleInput; id?: string; code?: string; activeOrders?: number; variant?: "new" | "edit" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<VehicleInput, unknown, VehicleValues>({ resolver: zodResolver(vehicleSchema), defaultValues: initial });
  const { register, control, handleSubmit, setError, formState: { errors } } = form;

  const onOpenChange = (next: boolean) => {
    if (next) {
      form.reset(initial);
      setFormKey((k) => k + 1);
    }
    setOpen(next);
  };

  const submit = async (values: VehicleInput) => {
    setSubmitting(true);
    try {
      const result = await safeAction(() => saveVehicle(values, id));
      if (result.ok) {
        toast.success(id ? `${values.plateNumber} を更新しました` : `${values.plateNumber} を登録しました（${result.code}）`, {
          action: id ? undefined : { label: "詳細を見る", onClick: () => router.push(`/vehicles/${result.id}`) },
        });
        setOpen(false);
        router.refresh();
      } else {
        for (const [k, msg] of Object.entries(result.fieldErrors ?? {})) setError(k as keyof VehicleInput, { message: msg });
        toast.error(result.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const blocked = (s: string) => activeOrders > 0 && (s === "maintenance" || s === "retired") && s !== initial.status;

  return (
    <>
      {variant === "new" ? (
        <Button onClick={() => onOpenChange(true)}><Plus aria-hidden />車両を登録</Button>
      ) : (
        <Button variant="outline" onClick={() => onOpenChange(true)}><Pencil aria-hidden />編集</Button>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{id ? `車両情報を編集（${code}）` : "車両を登録"}</DialogTitle>
            <DialogDescription>
              車検・保険の満了日が30日以内になると、一覧とダッシュボードに表示されます。
            </DialogDescription>
          </DialogHeader>
          <form key={formKey} onSubmit={handleSubmit(() => submit(form.getValues()))} className="grid gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="車両番号" htmlFor="plateNumber" error={errors.plateNumber?.message} required>
                <Input id="plateNumber" placeholder="例：品川 400 あ 12-34" aria-invalid={!!errors.plateNumber} {...register("plateNumber")} />
              </Field>
              <Field label="車種" htmlFor="vehicleType" error={errors.vehicleType?.message} required>
                <Input id="vehicleType" placeholder="例：軽バン、2t冷蔵車" aria-invalid={!!errors.vehicleType} {...register("vehicleType")} />
              </Field>
              <Field label="メーカー" htmlFor="maker" error={errors.maker?.message} required>
                <Input id="maker" placeholder="例：いすゞ" aria-invalid={!!errors.maker} {...register("maker")} />
              </Field>
              <Field label="車名・型式" htmlFor="model" error={errors.model?.message}>
                <Input id="model" placeholder="例：エルフ" aria-invalid={!!errors.model} {...register("model")} />
              </Field>
              <Field label="最大積載量（kg）" htmlFor="capacityKg" error={errors.capacityKg?.message}>
                <Input id="capacityKg" type="number" inputMode="numeric" min={1} step={50} aria-invalid={!!errors.capacityKg} {...register("capacityKg")} />
              </Field>
              <Field
                label="ステータス"
                htmlFor="status"
                error={errors.status?.message}
                required
                hint={activeOrders > 0 ? `対応中の案件${activeOrders}件で使用中のため、整備中・廃車は選べません` : "整備中・廃車にすると案件で使えなくなります"}
              >
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="status" aria-invalid={!!errors.status}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {VEHICLE_STATUSES.map((s) => (
                          <SelectItem key={s} value={s} disabled={blocked(s)}>{VEHICLE_STATUS_LABEL[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="車検満了日" htmlFor="inspectionExpiresOn" error={errors.inspectionExpiresOn?.message} required>
                <Input id="inspectionExpiresOn" type="date" aria-invalid={!!errors.inspectionExpiresOn} {...register("inspectionExpiresOn")} />
              </Field>
              <Field label="任意保険の満了日" htmlFor="insuranceExpiresOn" error={errors.insuranceExpiresOn?.message} required>
                <Input id="insuranceExpiresOn" type="date" aria-invalid={!!errors.insuranceExpiresOn} {...register("insuranceExpiresOn")} />
              </Field>
              <Field label="メモ" htmlFor="notes" error={errors.notes?.message} className="sm:col-span-2">
                <Textarea id="notes" rows={2} placeholder="例：パワーゲート付き" {...register("notes")} />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" aria-hidden />}
                {id ? "更新する" : "登録する"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
