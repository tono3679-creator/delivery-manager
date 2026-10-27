import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, MapPin, MessageSquareText, Navigation, Package, Phone, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LateBadge, StatusBadge } from "@/components/common/status-badge";
import { DriverStatusActions } from "@/components/driver/driver-status-actions";
import { NoteForm } from "@/components/orders/note-form";
import { StatusTimeline } from "@/components/orders/status-timeline";
import { addDriverNote } from "@/lib/actions/driver";
import { asDriver } from "@/lib/auth";
import { getDriverOrder } from "@/lib/data/driver";
import { formatDateShort, formatDateTimeFull, formatTime } from "@/lib/format";
import { directionsUrl, telUrl } from "@/lib/maps";

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "配送詳細" };

export default async function DriverOrderPage({ params }: Props) {
  const { id } = await params;
  // RLS により、他のドライバーの案件は取得できない（存在しない扱い）
  const order = await asDriver((tx) => getDriverOrder(tx, id));
  if (!order) notFound();
  // 次の行き先：集荷前は集荷先、集荷後は配送先。完了・失敗・キャンセル後は強調しない
  const next = order.status === "assigned" ? "pickup" : order.status === "picked_up" || order.status === "in_transit" ? "delivery" : null;

  return (
    <div className="space-y-4 pt-2">
      <Link href="/driver/orders" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" aria-hidden />本日の配送
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={order.status} />
          {order.isLate && <LateBadge />}
          <span className="text-xs text-muted-foreground tabular">{order.orderNo}</span>
        </div>
        <h1 className="text-xl font-bold leading-snug">{order.deliveryName}</h1>
        <p className="text-sm text-muted-foreground tabular">
          {formatDateShort(order.deliveryAt)} 集荷 {formatTime(order.pickupAt)} → 配送 {formatTime(order.deliveryAt)}
          {order.completedAt && `（完了 ${formatTime(order.completedAt)}）`}
        </p>
      </div>

      <DriverStatusActions orderId={order.id} orderNo={order.orderNo} status={order.status} />

      <Card>
        <CardContent className="grid gap-4 pt-5">
          <Stop
            icon={Building2}
            label="集荷先"
            name={order.clientName}
            address={order.pickupAddress}
            highlight={next === "pickup"}
            extra={order.clientContact ? `担当：${order.clientContact}` : undefined}
          />
          <Stop icon={MapPin} label="配送先" name={order.deliveryName} address={order.deliveryAddress} highlight={next === "delivery"} />
          <div className="grid grid-cols-2 gap-2">
            <Button asChild size="lg" variant={next === "pickup" ? "brand" : "outline"}>
              <a href={directionsUrl(order.pickupAddress)} target="_blank" rel="noopener noreferrer">
                <Navigation aria-hidden />集荷先へ案内
              </a>
            </Button>
            <Button asChild size="lg" variant={next === "delivery" ? "brand" : "outline"}>
              <a href={directionsUrl(order.deliveryAddress)} target="_blank" rel="noopener noreferrer">
                <Navigation aria-hidden />配送先へ案内
              </a>
            </Button>
          </div>
          {order.clientPhone && (
            <Button asChild size="lg" variant="outline">
              <a href={telUrl(order.clientPhone)}><Phone aria-hidden />荷主に電話（{order.clientPhone}）</a>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 pt-5 text-sm">
          <div className="flex items-start gap-2">
            <Package className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-xs text-muted-foreground">荷物</p>
              <p className="text-base font-medium">{order.cargoType} × {order.quantity}</p>
              {order.vehiclePlate && <p className="text-xs text-muted-foreground">使用車両：{order.vehiclePlate}</p>}
            </div>
          </div>
          {order.notes && (
            <div className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-warning-strong">
              <StickyNote className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <MessageSquareText className="size-4 text-muted-foreground" aria-hidden />メモ
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <NoteForm orderId={order.id} action={addDriverNote} placeholder="例：裏口の搬入口を利用" />
          {order.memos.map((m) => (
            <div key={m.id} className="rounded-md border px-3 py-2">
              <p className="text-sm whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 text-xs text-muted-foreground tabular">{m.author}・{formatDateTimeFull(m.at)}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>ステータス履歴</CardTitle></CardHeader>
        <CardContent><StatusTimeline logs={order.logs} /></CardContent>
      </Card>
    </div>
  );
}

function Stop({
  icon: Icon, label, name, address, highlight, extra,
}: { icon: typeof MapPin; label: string; name: string; address: string; highlight: boolean; extra?: string }) {
  return (
    <div className={highlight ? "rounded-lg border border-brand/30 bg-info-soft/60 p-3" : "p-3"}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-4" aria-hidden />{label}{highlight && <span className="text-brand">（次の行き先）</span>}
      </p>
      <p className="mt-1 font-semibold">{name}</p>
      <p className="text-sm">{address}</p>
      {extra && <p className="text-xs text-muted-foreground">{extra}</p>}
    </div>
  );
}
