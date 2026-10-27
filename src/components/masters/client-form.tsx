"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Building2, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/common/form-field";
import { saveClient } from "@/lib/actions/masters";
import { clientSchema, type ClientInput, type ClientValues } from "@/lib/validation/master";

export function ClientFormButton({
  initial, id, code, variant = "new",
}: { initial: ClientInput; id?: string; code?: string; variant?: "new" | "edit" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<ClientInput, unknown, ClientValues>({ resolver: zodResolver(clientSchema), defaultValues: initial });
  const { register, handleSubmit, setError, formState: { errors } } = form;

  const onOpenChange = (next: boolean) => {
    if (next) {
      form.reset(initial);
      setFormKey((k) => k + 1);
    }
    setOpen(next);
  };

  const submit = async (values: ClientInput) => {
    setSubmitting(true);
    try {
      const result = await saveClient(values, id);
      if (result.ok) {
        toast.success(id ? `${values.name} を更新しました` : `${values.name} を登録しました（${result.code}）`, {
          action: id ? undefined : { label: "詳細を見る", onClick: () => router.push(`/clients/${result.id}`) },
        });
        setOpen(false);
        router.refresh();
      } else {
        for (const [k, msg] of Object.entries(result.fieldErrors ?? {})) setError(k as keyof ClientInput, { message: msg });
        toast.error(result.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {variant === "new" ? (
        <Button onClick={() => onOpenChange(true)}><Building2 aria-hidden />荷主を登録</Button>
      ) : (
        <Button variant="outline" onClick={() => onOpenChange(true)}><Pencil aria-hidden />編集</Button>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{id ? `荷主情報を編集（${code}）` : "荷主を登録"}</DialogTitle>
            <DialogDescription>
              住所は案件登録のときに集荷先として自動で入ります。
            </DialogDescription>
          </DialogHeader>
          <form key={formKey} onSubmit={handleSubmit(() => submit(form.getValues()))} className="grid gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="会社名" htmlFor="name" error={errors.name?.message} required className="sm:col-span-2">
                <Input id="name" placeholder="例：株式会社みなと精密" aria-invalid={!!errors.name} {...register("name")} />
              </Field>
              <Field label="担当者名" htmlFor="contactName" error={errors.contactName?.message}>
                <Input id="contactName" placeholder="例：山本 由美" aria-invalid={!!errors.contactName} {...register("contactName")} />
              </Field>
              <Field label="電話番号" htmlFor="phone" error={errors.phone?.message}>
                <Input id="phone" type="tel" inputMode="tel" placeholder="例：03-1234-5678" aria-invalid={!!errors.phone} {...register("phone")} />
              </Field>
              <Field label="メールアドレス" htmlFor="email" error={errors.email?.message}>
                <Input id="email" type="email" inputMode="email" aria-invalid={!!errors.email} {...register("email")} />
              </Field>
              <Field label="取引開始日" htmlFor="startedOn" error={errors.startedOn?.message}>
                <Input id="startedOn" type="date" aria-invalid={!!errors.startedOn} {...register("startedOn")} />
              </Field>
              <Field label="住所（集荷先）" htmlFor="address" error={errors.address?.message} className="sm:col-span-2">
                <Input id="address" placeholder="例：東京都大田区平和島2-1-1" aria-invalid={!!errors.address} {...register("address")} />
              </Field>
              <Field label="メモ" htmlFor="notes" error={errors.notes?.message} className="sm:col-span-2">
                <Textarea id="notes" rows={2} placeholder="例：請求は月末締め翌月末払い" {...register("notes")} />
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
