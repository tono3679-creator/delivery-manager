"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/form-field";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveOrder, type Conflict } from "@/lib/actions/orders";
import { DRIVER_STATUS_LABEL, type DriverStatus } from "@/lib/domain/labels";
import { orderFormSchema, type OrderFormInput, type OrderFormValues } from "@/lib/validation/order";
import type { FormOptions } from "@/lib/data/orders";

const NONE = "__none";

/**
 * 案件の登録・編集ダイアログ。
 * lock … "driver"：集荷後（担当は変えられない） / "schedule"：完了・キャンセル済み（担当も予定も変えられない）
 */
export function OrderFormDialog({
  open, onOpenChange, options, initial, orderId, orderNo, lock,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: FormOptions;
  initial: OrderFormInput;
  orderId?: string;
  orderNo?: string;
  lock?: "driver" | "schedule";
}) {
  const lockDriver = lock === "driver" || lock === "schedule";
  const lockSchedule = lock === "schedule";
  const router = useRouter();
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<OrderFormInput, unknown, OrderFormValues>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: initial,
  });
  const { register, control, handleSubmit, formState: { errors }, setValue, getValues, setError } = form;

  const submit = async (values: OrderFormInput, confirmOverlap = false) => {
    setSubmitting(true);
    try {
      const result = await saveOrder(values, { id: orderId, confirmOverlap });
      if (result.ok) {
        toast.success(orderId ? `${result.orderNo} を更新しました` : `${result.orderNo} を登録しました`, {
          action: orderId ? undefined : { label: "詳細を見る", onClick: () => router.push(`/orders/${result.id}`) },
        });
        setConflicts(null);
        onOpenChange(false);
        if (!orderId) form.reset(initial);
        router.refresh();
      } else if ("needsConfirm" in result) {
        setConflicts(result.conflicts);
      } else {
        if (result.fieldErrors) {
          for (const [k, msg] of Object.entries(result.fieldErrors)) setError(k as keyof OrderFormInput, { message: msg });
        }
        toast.error(result.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onClientChange = (clientId: string) => {
    const prev = options.clients.find((c) => c.id === getValues("clientId"));
    const next = options.clients.find((c) => c.id === clientId);
    const current = getValues("pickupAddress");
    // 集荷先が未入力か、前の荷主の住所のままなら新しい荷主の住所に置き換える
    if (next?.address && (!current || current === prev?.address)) setValue("pickupAddress", next.address, { shouldValidate: true });
  };

  const onDriverChange = (driverId: string) => {
    const driver = options.drivers.find((d) => d.id === driverId);
    if (driver?.vehicleId) setValue("vehicleId", driver.vehicleId);
    if (!driverId) setValue("vehicleId", "");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{orderId ? `案件を編集（${orderNo}）` : "配送案件を登録"}</DialogTitle>
            <DialogDescription>
              {orderId ? "変更内容は配車ボードとドライバー画面にすぐ反映されます。" : "ドライバーを選ぶと「配車済」として登録されます。後から配車ボードで割り当てることもできます。"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => submit(v as unknown as OrderFormInput))} className="grid gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="荷主" htmlFor="clientId" error={errors.clientId?.message} required className="sm:col-span-2">
                <Controller
                  control={control}
                  name="clientId"
                  render={({ field }) => (
                    <Select value={field.value || undefined} onValueChange={(v) => { onClientChange(v); field.onChange(v); }}>
                      <SelectTrigger id="clientId" aria-invalid={!!errors.clientId}><SelectValue placeholder="荷主を選択" /></SelectTrigger>
                      <SelectContent>
                        {options.clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="集荷先住所" htmlFor="pickupAddress" error={errors.pickupAddress?.message} required className="sm:col-span-2">
                <Input id="pickupAddress" aria-invalid={!!errors.pickupAddress} {...register("pickupAddress")} />
              </Field>
              <Field label="配送先名" htmlFor="deliveryName" error={errors.deliveryName?.message} required>
                <Input id="deliveryName" placeholder="例：あおばクリニック 芝浦" aria-invalid={!!errors.deliveryName} {...register("deliveryName")} />
              </Field>
              <Field label="配送先住所" htmlFor="deliveryAddress" error={errors.deliveryAddress?.message} required>
                <Input id="deliveryAddress" placeholder="例：東京都港区芝浦3-4-1" aria-invalid={!!errors.deliveryAddress} {...register("deliveryAddress")} />
              </Field>
              <Field label="集荷予定日時" htmlFor="pickupAt" error={errors.pickupAt?.message} required>
                <Input id="pickupAt" type="datetime-local" step={300} readOnly={lockSchedule} aria-invalid={!!errors.pickupAt} {...register("pickupAt")} />
              </Field>
              <Field label="配送予定日時" htmlFor="deliveryAt" error={errors.deliveryAt?.message} required>
                <Input id="deliveryAt" type="datetime-local" step={300} readOnly={lockSchedule} aria-invalid={!!errors.deliveryAt} {...register("deliveryAt")} />
              </Field>
              <Field label="担当ドライバー" htmlFor="driverId" error={errors.driverId?.message}>
                <Controller
                  control={control}
                  name="driverId"
                  render={({ field }) => (
                    <Select disabled={lockDriver} value={field.value || NONE} onValueChange={(v) => { const id = v === NONE ? "" : v; onDriverChange(id); field.onChange(id); }}>
                      <SelectTrigger id="driverId"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>未割当</SelectItem>
                        {options.drivers.map((d) => (
                          <SelectItem key={d.id} value={d.id} disabled={d.status === "leave" || d.status === "retired"}>
                            {d.name}
                            {d.status !== "active" && `（${DRIVER_STATUS_LABEL[d.status as DriverStatus]}）`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="使用車両" htmlFor="vehicleId" error={errors.vehicleId?.message}>
                <Controller
                  control={control}
                  name="vehicleId"
                  render={({ field }) => (
                    <Select disabled={lockDriver} value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                      <SelectTrigger id="vehicleId"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>指定なし</SelectItem>
                        {options.vehicles.map((v) => (
                          <SelectItem key={v.id} value={v.id} disabled={v.status === "maintenance"}>
                            {v.plate}（{v.type}{v.status === "maintenance" ? "・整備中" : ""}）
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              {lock && (
                <p className="text-keep text-xs text-muted-foreground sm:col-span-2">
                  {lockSchedule ? "完了・キャンセル済みのため、担当と予定日時は変更できません。" : "集荷後のため、担当ドライバーと車両は変更できません。"}
                </p>
              )}
              <Field label="荷物の種類" htmlFor="cargoType" error={errors.cargoType?.message} required>
                <Input id="cargoType" placeholder="例：医療機器" aria-invalid={!!errors.cargoType} {...register("cargoType")} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="数量" htmlFor="quantity" error={errors.quantity?.message} required>
                  <Input id="quantity" type="number" inputMode="numeric" min={1} aria-invalid={!!errors.quantity} {...register("quantity", { valueAsNumber: true })} />
                </Field>
                <Field label="配送料金（円）" htmlFor="fee" error={errors.fee?.message} required>
                  <Input id="fee" type="number" inputMode="numeric" min={0} step={100} aria-invalid={!!errors.fee} {...register("fee", { valueAsNumber: true })} />
                </Field>
              </div>
              <Field label="備考" htmlFor="notes" error={errors.notes?.message} className="sm:col-span-2">
                <Textarea id="notes" rows={2} placeholder="例：午前中必着、要事前連絡" {...register("notes")} />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" aria-hidden />}
                {orderId ? "更新する" : "登録する"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={conflicts !== null} onOpenChange={(o) => !o && setConflicts(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-warning-strong" aria-hidden />
              配送予定が重複しています
            </AlertDialogTitle>
            <AlertDialogDescription>
              このドライバーには同じ時間帯に次の案件があります。順番に回れる場合はこのまま保存できます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="grid gap-1.5 rounded-lg bg-warning-soft p-3 text-sm">
            {conflicts?.map((c) => (
              <li key={c.id} className="flex justify-between gap-3">
                <span className="truncate">{c.orderNo} {c.deliveryName}</span>
                <span className="shrink-0 tabular text-muted-foreground">{c.window}</span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>戻って修正する</AlertDialogCancel>
            <Button
              variant="default"
              disabled={submitting}
              onClick={() => handleSubmit((v) => submit(v as unknown as OrderFormInput, true))()}
            >
              {submitting && <Loader2 className="animate-spin" aria-hidden />}
              重複を承知で保存
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
