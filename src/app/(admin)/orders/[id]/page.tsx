import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CalendarClock, ExternalLink, MapPin, MessageSquareText, Package, Phone, Truck, UserRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LateBadge, StatusBadge } from "@/components/common/status-badge";
import { NoteForm } from "@/components/orders/note-form";
import { OrderDetailActions } from "@/components/orders/order-detail-actions";
import { StatusActions } from "@/components/orders/status-actions";
import { StatusTimeline } from "@/components/orders/status-timeline";
import { ViewAsDriverButton } from "@/components/orders/view-as-driver-button";
import { addOrderNote } from "@/lib/actions/orders";
import { toJstDate } from "@/lib/date";
import { asAdmin } from "@/lib/auth";
import { getFormOptions, getOrderDetail } from "@/lib/data/orders";
import { formatDateLong, formatDateTimeFull, formatNumber, formatTime, formatYen } from "@/lib/format";
import { mapSearchUrl, telUrl } from "@/lib/maps";
import { orderToForm } from "@/lib/validation/order";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const order = await asAdmin((tx) => getOrderDetail(tx, id));
  return { title: order ? `${order.orderNo} 配送案件` : "配送案件" };
}

export default async function OrderDetailPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { order, options, isDemo } = await asAdmin(async (tx, user) => {
    const [order, options] = await Promise.all([getOrderDetail(tx, id), getFormOptions(tx)]);
    return { order, options, isDemo: user.isDemo };
  });
  if (!order) notFound();

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          配送案件一覧
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight tabular sm:text-2xl">{order.orderNo}</h1>
              <StatusBadge status={order.status} />
              {order.isLate && <LateBadge />}
            </div>
            <p className="text-keep text-sm text-muted-foreground">
              {order.clientName} → {order.deliveryName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <OrderDetailActions
              orderId={order.id}
              orderNo={order.orderNo}
              status={order.status}
              options={options}
              initial={orderToForm(order)}
              editOnOpen={sp.edit === "1"}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>配送内容</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <Item icon={CalendarClock} label="配送予定">
                  <span className="tabular">{formatDateLong(order.deliveryAt)}</span>
                  <span className="block text-sm text-muted-foreground tabular">
                    集荷 {formatTime(order.pickupAt)} ／ 配送 {formatTime(order.deliveryAt)}
                  </span>
                  {order.completedAt && (
                    <span className="block text-sm text-muted-foreground tabular">完了 {formatDateTimeFull(order.completedAt)}</span>
                  )}
                </Item>
                <Item icon={Package} label="荷物・料金">
                  {order.cargoType} × {formatNumber(order.quantity)}
                  <span className="block text-sm tabular">{formatYen(order.fee)}</span>
                </Item>
                <Item icon={Building2} label="集荷先（荷主）">
                  {order.clientName}
                  <span className="block text-sm text-muted-foreground">{order.pickupAddress}</span>
                  {order.clientContact && <span className="block text-sm text-muted-foreground">担当：{order.clientContact}</span>}
                  {order.clientPhone && (
                    <a href={telUrl(order.clientPhone)} className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
                      <Phone className="size-3.5" aria-hidden />{order.clientPhone}
                    </a>
                  )}
                </Item>
                <Item icon={MapPin} label="配送先">
                  {order.deliveryName}
                  <span className="block text-sm text-muted-foreground">{order.deliveryAddress}</span>
                  <a href={mapSearchUrl(order.deliveryAddress)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
                    地図で見る<ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </Item>
                {order.notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-medium text-muted-foreground">備考</dt>
                    <dd className="mt-1 rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{order.notes}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>ステータス履歴</CardTitle></CardHeader>
            <CardContent>
              <StatusTimeline logs={order.logs} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>ステータスの変更</CardTitle></CardHeader>
            <CardContent>
              <StatusActions orderId={order.id} status={order.status} driverId={order.driverId} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>担当</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <dl className="grid gap-4">
              <Item icon={UserRound} label="ドライバー">
                {order.driverName ?? <span className="text-muted-foreground">未割当</span>}
                {order.driverPhone && (
                  <a href={telUrl(order.driverPhone)} className="flex items-center gap-1 text-sm text-brand hover:underline">
                    <Phone className="size-3.5" aria-hidden />{order.driverPhone}
                  </a>
                )}
              </Item>
              <Item icon={Truck} label="車両">
                {order.vehiclePlate ? (
                  <>
                    {order.vehiclePlate}
                    <span className="block text-sm text-muted-foreground">{order.vehicleType}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">指定なし</span>
                )}
              </Item>
              </dl>
              {(order.status === "unassigned" || order.status === "assigned") && (
                <Link href={`/dispatch?date=${toJstDate(order.deliveryAt)}`} className="text-sm text-brand hover:underline">
                  配車ボードで確認する
                </Link>
              )}
              {isDemo && order.driverId && order.driverName && (
                <ViewAsDriverButton driverId={order.driverId} driverName={order.driverName} orderId={order.id} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <MessageSquareText className="size-4 text-muted-foreground" aria-hidden />
                メモ
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <NoteForm orderId={order.id} action={addOrderNote} />
              {order.memos.length > 0 ? (
                <ul className="grid gap-3">
                  {order.memos.map((m) => (
                    <li key={m.id} className="rounded-md border px-3 py-2">
                      <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                      <p className="mt-1 text-xs text-muted-foreground tabular">{m.author}・{formatDateTimeFull(m.at)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">メモはまだありません。</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Item({ icon: Icon, label, children }: { icon: typeof MapPin; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-words">{children}</dd>
      </div>
    </div>
  );
}
