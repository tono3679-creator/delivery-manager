"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FormOptions } from "@/lib/data/orders";
import { emptyOrderForm } from "@/lib/validation/order";
import { OrderFormDialog } from "./order-form-dialog";

/** 新規登録ボタン（初期値は翌日 9:00〜10:00。日付はサーバーから受け取り、表示のずれを防ぐ） */
export function NewOrderButton({ options, defaultDay, label = "新規登録" }: { options: FormOptions; defaultDay: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {label}
      </Button>
      <OrderFormDialog open={open} onOpenChange={setOpen} options={options} initial={emptyOrderForm(defaultDay)} />
    </>
  );
}
