"use client";
import { useTransition } from "react";
import { Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { switchDemoRole } from "@/lib/actions/session";

/** デモ環境のみ：担当ドライバーの画面に切り替えて、この案件がどう見えるかを確認する */
export function ViewAsDriverButton({ driverId, driverName, orderId }: { driverId: string; driverName: string; orderId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      className="h-auto min-h-9 w-full py-2 whitespace-normal"
      disabled={pending}
      onClick={() => startTransition(() => switchDemoRole("driver", driverId, `/driver/orders/${orderId}`))}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Smartphone aria-hidden />}
      {driverName}さんの画面で確認（デモ）
    </Button>
  );
}
