"use client";
import { useState } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/form-field";
import { saveOffice } from "@/lib/actions/settings";
import { EMPTY_OFFICE_FORM, officeSchema, type OfficeInput } from "@/lib/validation/settings";

/** 営業所の登録・編集 */
export function OfficeFormButton({ initial = EMPTY_OFFICE_FORM, id }: { initial?: OfficeInput; id?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<OfficeInput>({ resolver: zodResolver(officeSchema), defaultValues: initial });
  const { register, handleSubmit, setError, formState: { errors } } = form;

  const onOpenChange = (next: boolean) => {
    if (next) form.reset(initial);
    setOpen(next);
  };

  const submit = async (values: OfficeInput) => {
    setSubmitting(true);
    try {
      const result = await saveOffice(values, id);
      if (result.ok) {
        toast.success(id ? `${values.name.trim()} を更新しました` : `${values.name.trim()} を登録しました`);
        setOpen(false);
        router.refresh();
      } else {
        for (const [k, msg] of Object.entries(result.fieldErrors ?? {})) setError(k as keyof OfficeInput, { message: msg });
        toast.error(result.error);
      }
    } catch (e) {
      unstable_rethrow(e);
      toast.error("通信できませんでした。接続を確認してから、もう一度お試しください");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {id ? (
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(true)} aria-label={`${initial.name} を編集`}>
          <Pencil aria-hidden />
          編集
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => onOpenChange(true)}>
          <Plus aria-hidden />
          営業所を追加
        </Button>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{id ? "営業所を編集" : "営業所を追加"}</DialogTitle>
            <DialogDescription>ドライバーの所属先として選べるようになります。</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(submit)} className="grid gap-4" noValidate>
            <Field label="営業所名" htmlFor="officeName" error={errors.name?.message} required>
              <Input id="officeName" placeholder="例：品川営業所" aria-invalid={!!errors.name} {...register("name")} />
            </Field>
            <Field label="住所" htmlFor="officeAddress" error={errors.address?.message} required>
              <Input id="officeAddress" placeholder="例：東京都品川区東品川2-3-14" aria-invalid={!!errors.address} {...register("address")} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" aria-hidden />}
                {id ? "更新する" : "追加する"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
