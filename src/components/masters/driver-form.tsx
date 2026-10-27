"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Pencil, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/form-field";
import { saveDriver } from "@/lib/actions/masters";
import { DRIVER_STATUSES, DRIVER_STATUS_LABEL, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL } from "@/lib/domain/labels";
import { driverSchema, type DriverInput, type DriverValues } from "@/lib/validation/master";
import { safeAction } from "@/lib/client/safe-action";

const NONE = "__none";

/**
 * ドライバーの登録・編集ボタン（押すとダイアログが開く）。
 * activeOrders … 対応中の案件数。1件以上なら休職・退職を選べない（サーバーと DB でも拒否する）。
 */
export function DriverFormButton({
  initial, id, code, offices, activeOrders = 0, variant = "new",
}: {
  initial: DriverInput; id?: string; code?: string; offices: { id: string; name: string }[]; activeOrders?: number; variant?: "new" | "edit";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<DriverInput, unknown, DriverValues>({ resolver: zodResolver(driverSchema), defaultValues: initial });
  const { register, control, handleSubmit, setError, formState: { errors } } = form;

  const onOpenChange = (next: boolean) => {
    if (next) {
      form.reset(initial);
      setFormKey((k) => k + 1);
    }
    setOpen(next);
  };

  const submit = async (values: DriverInput) => {
    setSubmitting(true);
    try {
      const result = await safeAction(() => saveDriver(values, id));
      if (result.ok) {
        toast.success(id ? `${values.name}さんの情報を更新しました` : `${values.name}さんを登録しました（${result.code}）`, {
          action: id ? undefined : { label: "詳細を見る", onClick: () => router.push(`/drivers/${result.id}`) },
        });
        setOpen(false);
        router.refresh();
      } else {
        for (const [k, msg] of Object.entries(result.fieldErrors ?? {})) setError(k as keyof DriverInput, { message: msg });
        toast.error(result.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const blocked = (s: string) => activeOrders > 0 && (s === "leave" || s === "retired") && s !== initial.status;

  return (
    <>
      {variant === "new" ? (
        <Button onClick={() => onOpenChange(true)}><UserPlus aria-hidden />ドライバーを登録</Button>
      ) : (
        <Button variant="outline" onClick={() => onOpenChange(true)}><Pencil aria-hidden />編集</Button>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{id ? `ドライバー情報を編集（${code}）` : "ドライバーを登録"}</DialogTitle>
            <DialogDescription>
              {id ? "変更内容は配車ボードと案件の担当候補にすぐ反映されます。" : "管理コード（D-001 など）は自動で付きます。登録後すぐに配車の候補になります。"}
            </DialogDescription>
          </DialogHeader>
          <form key={formKey} onSubmit={handleSubmit(() => submit(form.getValues()))} className="grid gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="氏名" htmlFor="name" error={errors.name?.message} required>
                <Input id="name" placeholder="例：佐藤 健太" aria-invalid={!!errors.name} {...register("name")} />
              </Field>
              <Field label="フリガナ" htmlFor="nameKana" error={errors.nameKana?.message}>
                <Input id="nameKana" placeholder="例：サトウ ケンタ" aria-invalid={!!errors.nameKana} {...register("nameKana")} />
              </Field>
              <Field label="電話番号" htmlFor="phone" error={errors.phone?.message}>
                <Input id="phone" type="tel" inputMode="tel" placeholder="例：090-1234-5678" aria-invalid={!!errors.phone} {...register("phone")} />
              </Field>
              <Field label="メールアドレス" htmlFor="email" error={errors.email?.message}>
                <Input id="email" type="email" inputMode="email" aria-invalid={!!errors.email} {...register("email")} />
              </Field>
              <Field label="営業所" htmlFor="officeId" error={errors.officeId?.message}>
                <Controller
                  control={control}
                  name="officeId"
                  render={({ field }) => (
                    <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                      <SelectTrigger id="officeId"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>指定なし</SelectItem>
                        {offices.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="雇用形態" htmlFor="employmentType" error={errors.employmentType?.message} required>
                <Controller
                  control={control}
                  name="employmentType"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="employmentType"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {EMPLOYMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{EMPLOYMENT_TYPE_LABEL[t]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field
                label="ステータス"
                htmlFor="status"
                error={errors.status?.message}
                required
                hint={activeOrders > 0 ? `対応中の案件が${activeOrders}件あるため、休職・退職は選べません` : "休職中・退職にすると配車の候補から外れます"}
              >
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="status" aria-invalid={!!errors.status}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DRIVER_STATUSES.map((s) => (
                          <SelectItem key={s} value={s} disabled={blocked(s)}>{DRIVER_STATUS_LABEL[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="入社日・契約開始日" htmlFor="hiredOn" error={errors.hiredOn?.message} required>
                <Input id="hiredOn" type="date" aria-invalid={!!errors.hiredOn} {...register("hiredOn")} />
              </Field>
              <Field label="メモ" htmlFor="notes" error={errors.notes?.message} className="sm:col-span-2">
                <Textarea id="notes" rows={2} placeholder="例：中型免許あり。冷蔵車の運転経験あり" {...register("notes")} />
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
