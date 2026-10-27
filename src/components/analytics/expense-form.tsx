"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/common/form-field";
import { deleteExpense, saveExpense } from "@/lib/actions/expenses";
import type { ExpenseFormOptions } from "@/lib/data/analytics";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL } from "@/lib/domain/labels";
import { formatYen } from "@/lib/format";
import { expenseSchema, type ExpenseInput, type ExpenseValues } from "@/lib/validation/master";

const NONE = "__none";

function ExpenseFormDialog({
  open, onOpenChange, initial, id, options, today,
}: { open: boolean; onOpenChange: (open: boolean) => void; initial: ExpenseInput; id?: string; options: ExpenseFormOptions; today: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<ExpenseInput, unknown, ExpenseValues>({ resolver: zodResolver(expenseSchema), defaultValues: initial });
  const { register, control, handleSubmit, setError, formState: { errors } } = form;

  const submit = async (values: ExpenseInput) => {
    setSubmitting(true);
    try {
      const result = await saveExpense(values, id);
      if (result.ok) {
        toast.success(id ? "経費を更新しました" : `${EXPENSE_CATEGORY_LABEL[values.category]} ${formatYen(values.amount)} を登録しました`);
        onOpenChange(false);
        if (!id) form.reset(initial);
        router.refresh();
      } else {
        for (const [k, msg] of Object.entries(result.fieldErrors ?? {})) setError(k as keyof ExpenseInput, { message: msg });
        toast.error(result.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{id ? "経費を編集" : "経費を登録"}</DialogTitle>
          <DialogDescription>登録した経費は、すぐに粗利益とダッシュボードに反映されます。</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(() => submit(form.getValues()))} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="日付" htmlFor="spentOn" error={errors.spentOn?.message} required>
              <Input id="spentOn" type="date" max={today} aria-invalid={!!errors.spentOn} {...register("spentOn")} />
            </Field>
            <Field label="カテゴリ" htmlFor="category" error={errors.category?.message} required>
              <Controller
                control={control}
                name="category"
                render={({ field }) => (
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <SelectTrigger id="category" aria-invalid={!!errors.category}><SelectValue placeholder="選択してください" /></SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{EXPENSE_CATEGORY_LABEL[c]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="金額（円）" htmlFor="amount" error={errors.amount?.message} required>
              <Input id="amount" type="number" inputMode="numeric" min={0} step={1} aria-invalid={!!errors.amount} {...register("amount", { valueAsNumber: true })} />
            </Field>
            <Field label="ドライバー" htmlFor="driverId" error={errors.driverId?.message}>
              <Controller
                control={control}
                name="driverId"
                render={({ field }) => (
                  <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                    <SelectTrigger id="driverId"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>指定なし</SelectItem>
                      {options.drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}{d.retired && "（退職）"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="車両" htmlFor="vehicleId" error={errors.vehicleId?.message} className="sm:col-span-2">
              <Controller
                control={control}
                name="vehicleId"
                render={({ field }) => (
                  <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                    <SelectTrigger id="vehicleId"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>指定なし</SelectItem>
                      {options.vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.plate}{v.retired && "（廃車）"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="内容" htmlFor="description" error={errors.description?.message} className="sm:col-span-2">
              <Input id="description" placeholder="例：首都高速 湾岸線（10月分）" aria-invalid={!!errors.description} {...register("description")} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>キャンセル</Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden />}
              {id ? "更新する" : "登録する"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NewExpenseButton({ options, today }: { options: ExpenseFormOptions; today: string }) {
  const [open, setOpen] = useState(false);
  const initial: ExpenseInput = { spentOn: today, category: "fuel", amount: Number.NaN, driverId: "", vehicleId: "", description: "" };
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus aria-hidden />経費を登録</Button>
      {open && <ExpenseFormDialog open={open} onOpenChange={setOpen} initial={initial} options={options} today={today} />}
    </>
  );
}

export function ExpenseRowActions({
  expense, options, today,
}: { expense: ExpenseInput & { id: string }; options: ExpenseFormOptions; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const { id, ...initial } = expense;
  const label = `${EXPENSE_CATEGORY_LABEL[expense.category]} ${formatYen(expense.amount)}`;

  const onDelete = async () => {
    setPending(true);
    const result = await deleteExpense(id);
    setPending(false);
    setConfirm(false);
    if (!result.ok) return toast.error(result.error);
    toast.success(`${label} を削除しました`);
    router.refresh();
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`${label} の操作`}><MoreHorizontal aria-hidden /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil aria-hidden />編集する</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive [&_svg]:text-destructive" onSelect={() => setConfirm(true)}>
            <Trash2 aria-hidden />削除する
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing && <ExpenseFormDialog open={editing} onOpenChange={setEditing} initial={initial} id={id} options={options} today={today} />}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{label} を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>削除すると粗利益の集計から外れ、元に戻せません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>やめる</AlertDialogCancel>
            <Button variant="destructive" onClick={onDelete} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              削除する
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
