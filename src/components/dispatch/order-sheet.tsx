"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LateBadge, StatusBadge } from "@/components/common/status-badge";
import type { AssignInput } from "@/lib/actions/dispatch";
import type { BoardDriver, BoardOrder } from "@/lib/data/dispatch";
import { jstDateTime, toJstDate } from "@/lib/date";
import { hhmmToMinutes, minutesFromDayStart, minutesToHhmm } from "@/lib/domain/board";
import { DRIVER_STATUS_LABEL } from "@/lib/domain/labels";
import { formatYen } from "@/lib/format";

const NONE = "__none";

/**
 * 案件をクリックしたときの詳細パネル。
 * ドラッグできない環境（キーボード・スクリーンリーダー・スマホ）でも、ここから担当と時刻を変更できる。
 */
export function OrderSheet({
  order, base, drivers, onOpenChange, onAssign,
}: {
  order: BoardOrder | null;
  /** サーバーから受け取った状態（同時操作の確認に使う） */
  base: BoardOrder | null;
  drivers: BoardDriver[];
  onOpenChange: (open: boolean) => void;
  onAssign: (input: AssignInput, message: string) => Promise<void>;
}) {
  return (
    <Sheet open={order !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[26rem] overflow-y-auto bg-card" aria-describedby={undefined}>
        {order && base && <SheetBody key={`${base.id}:${base.driverId}:${base.pickupAt}:${base.deliveryAt}`} order={order} base={base} drivers={drivers} onAssign={onAssign} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({
  order, base, drivers, onAssign, onDone,
}: {
  order: BoardOrder; base: BoardOrder; drivers: BoardDriver[];
  onAssign: (input: AssignInput, message: string) => Promise<void>; onDone: () => void;
}) {
  const editable = base.status === "unassigned" || base.status === "assigned";
  const [driverId, setDriverId] = useState(base.driverId ?? "");
  const [pickup, setPickup] = useState(minutesToHhmm(minutesFromDayStart(toJstDate(new Date(base.pickupAt)), base.pickupAt)));
  const [delivery, setDelivery] = useState(minutesToHhmm(minutesFromDayStart(toJstDate(new Date(base.deliveryAt)), base.deliveryAt)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (nextDriverId: string | null) => {
    setError(null);
    const p = hhmmToMinutes(pickup);
    const d = hhmmToMinutes(delivery);
    if (p === null || d === null) return setError("時刻を入力してください");
    const pickupAt = jstDateTime(toJstDate(new Date(base.pickupAt)), p).toISOString();
    const deliveryAt = jstDateTime(toJstDate(new Date(base.deliveryAt)), d).toISOString();
    if (new Date(deliveryAt) < new Date(pickupAt)) return setError("配送予定は集荷予定より後にしてください");
    const timeChanged = pickupAt !== new Date(base.pickupAt).toISOString() || deliveryAt !== new Date(base.deliveryAt).toISOString();
    if (nextDriverId === base.driverId && !timeChanged) return onDone();
    const name = drivers.find((x) => x.id === nextDriverId)?.name;
    setPending(true);
    onDone();
    await onAssign(
      {
        orderId: base.id,
        driverId: nextDriverId,
        expectedStatus: base.status,
        expectedDriverId: base.driverId,
        ...(timeChanged ? { pickupAt, deliveryAt } : {}),
      },
      nextDriverId ? `${base.orderNo} を ${name}さんに配車しました（${pickup}〜${delivery}）` : `${base.orderNo} を未割当に戻しました`,
    );
    setPending(false);
  };

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <SheetTitle className="text-lg font-semibold tabular">{order.orderNo}</SheetTitle>
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge status={order.status} />
            {order.isLate && <LateBadge />}
          </div>
        </div>
        <SheetClose asChild>
          <Button variant="ghost" size="icon-sm" aria-label="閉じる"><X aria-hidden /></Button>
        </SheetClose>
      </div>

      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">配送先</dt>
          <dd className="font-medium">{order.deliveryName}</dd>
          <dd className="text-muted-foreground">{order.deliveryAddress}</dd>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-muted-foreground">荷主</dt>
            <dd>{order.clientName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">荷物・料金</dt>
            <dd>{order.cargoType} × {order.quantity}</dd>
            <dd className="tabular">{formatYen(order.fee)}</dd>
          </div>
        </div>
      </dl>

      {editable ? (
        <form
          className="grid gap-4 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            save(driverId || null);
          }}
        >
          <p className="text-sm font-semibold">配車</p>
          <div className="grid gap-1.5">
            <Label htmlFor="sheet-driver">担当ドライバー</Label>
            <Select value={driverId || NONE} onValueChange={(v) => setDriverId(v === NONE ? "" : v)}>
              <SelectTrigger id="sheet-driver"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>未割当</SelectItem>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={d.id} disabled={d.status === "leave"}>
                    {d.name}{d.status !== "active" && `（${DRIVER_STATUS_LABEL[d.status]}）`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sheet-pickup">集荷予定</Label>
              <Input id="sheet-pickup" type="time" step={300} value={pickup} onChange={(e) => setPickup(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sheet-delivery">配送予定</Label>
              <Input id="sheet-delivery" type="time" step={300} value={delivery} onChange={(e) => setDelivery(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {base.driverId && (
              <Button type="button" variant="outline" disabled={pending} onClick={() => save(null)}>配車を解除</Button>
            )}
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              保存する
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">同じドライバーの予定と重なる場合は、保存前に確認します。</p>
        </form>
      ) : (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
          集荷後・完了済みの案件は配車を変更できません。
        </p>
      )}

      <Button asChild variant="ghost" className="justify-between">
        <Link href={`/orders/${order.id}`}>
          案件の詳細を開く
          <ArrowRight aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
