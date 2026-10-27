"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/form-field";
import { updateCompanyName } from "@/lib/actions/settings";
import { companySchema, type CompanyInput } from "@/lib/validation/settings";

/** 会社名の変更（サイドバー・ヘッダーの表示も変わる） */
export function CompanyNameForm({ name }: { name: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const { register, handleSubmit, setError, reset, formState: { errors, isDirty } } = useForm<CompanyInput>({
    resolver: zodResolver(companySchema),
    defaultValues: { name },
  });

  const submit = async (values: CompanyInput) => {
    setSubmitting(true);
    try {
      const result = await updateCompanyName(values);
      if (result.ok) {
        toast.success("会社名を変更しました");
        reset({ name: values.name.trim() });
        router.refresh();
      } else {
        if (result.fieldErrors?.name) setError("name", { message: result.fieldErrors.name });
        toast.error(result.error);
      }
    } catch {
      toast.error("通信できませんでした。接続を確認してから、もう一度お試しください");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-3 sm:flex-row sm:items-start" noValidate>
      <Field label="会社名" htmlFor="companyName" error={errors.name?.message} required className="min-w-0 flex-1">
        <Input id="companyName" autoComplete="organization" aria-invalid={!!errors.name} {...register("name")} />
      </Field>
      <Button type="submit" disabled={submitting || !isDirty} className="sm:mt-[22px]">
        {submitting && <Loader2 className="animate-spin" aria-hidden />}
        変更を保存
      </Button>
    </form>
  );
}
