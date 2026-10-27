"use client";
import { useState } from "react";
import Link from "next/link";
import { Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DELETABLE_STATUSES, type OrderStatus } from "@/lib/domain/status";
import { DeleteOrderDialog } from "./delete-order-dialog";

export function OrderRowActions({ id, orderNo, status }: { id: string; orderNo: string; status: OrderStatus }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`${orderNo} の操作`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/orders/${id}`}><Eye aria-hidden />詳細を見る</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/orders/${id}?edit=1`}><Pencil aria-hidden />編集する</Link>
          </DropdownMenuItem>
          {DELETABLE_STATUSES.includes(status) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive [&_svg]:text-destructive" onSelect={() => setConfirm(true)}>
                <Trash2 aria-hidden />削除する
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteOrderDialog open={confirm} onOpenChange={setConfirm} orderId={id} orderNo={orderNo} />
    </>
  );
}
