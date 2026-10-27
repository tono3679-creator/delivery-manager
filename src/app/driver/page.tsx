import Link from "next/link";
import { ArrowRight, CalendarCheck, Navigation, Package, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LateBadge, StatusBadge } from "@/components/common/status-badge";
import { DriverOrderCardLink } from "@/components/driver/order-card";
import { DriverStatusActions } from "@/components/driver/driver-status-actions";
import { asDriver } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { getDriverDay, getDriverMonthStats, getDriverUpcoming } from "@/lib/data/driver";
import { ACTIVE_STATUSES } from "@/lib/domain/status";
import { formatDateLong, formatTime } from "@/lib/format";
import { directionsUrl } from "@/lib/maps";

export const metadata = { title: "ホーム" };

export default async function DriverHomePage() {
  const today = todayJst();
  const { user, orders, upcoming, month } = await asDriver(async (tx, user) => {
    const [orders, upcoming, month] = await Promise.all([getDriverDay(tx, today), getDriverUpcoming(tx, today, 3), getDriverMonthStats(tx, today)]);
    return { user, orders, upcoming, month };
  });

  const done = orders.filter((o) => o.status === "delivered").length;
  const failed = orders.filter((o) => o.status === "failed").length;
  const remaining = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
  // 集荷済み・配送中を優先し、次に集荷予定の早い順
  const current = remaining.find((o) => o.status === "in_transit") ?? remaining.find((o) => o.status === "picked_up") ?? remaining[0];
  const progress = orders.length === 0 ? 0 : Math.round(((done + failed) / orders.length) * 100);

  return (
    <div className="space-y-5 pt-2">
      <div>
        <p className="text-sm text-muted-foreground tabular">{formatDateLong(today)}</p>
        <h1 className="text-xl font-bold">{user.displayName}さん、おつかれさまです</h1>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-sm text-muted-foreground">本日の配送</p>
              <p className="text-3xl font-bold tabular">
                {done + failed}<span className="text-lg text-muted-foreground"> / {orders.length}件</span>
              </p>
            </div>
            <div className="text-right text-sm">
              <p>残り <strong className="text-lg tabular">{remaining.length}</strong> 件</p>
              {failed > 0 && <p className="text-danger-strong">配送失敗 {failed}件</p>}
            </div>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="本日の進み具合">
            <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </CardContent>
      </Card>

      {current ? (
        <section aria-labelledby="current-heading" className="space-y-2">
          <h2 id="current-heading" className="text-sm font-semibold text-muted-foreground">
            {current.status === "assigned" ? "次の配送" : "対応中の配送"}
          </h2>
          <Card className="border-brand/30 ring-1 ring-brand/10">
            <CardContent className="space-y-4 pt-5">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={current.status} />
                {current.isLate && <LateBadge />}
                <span className="text-xs text-muted-foreground tabular">{current.orderNo}</span>
              </div>
              <div>
                <p className="text-lg font-bold leading-snug">{current.deliveryName}</p>
                <p className="text-sm text-muted-foreground">{current.deliveryAddress}</p>
              </div>
              <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">集荷予定</dt>
                  <dd className="text-base font-semibold tabular">{formatTime(current.pickupAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">配送予定</dt>
                  <dd className="text-base font-semibold tabular">{formatTime(current.deliveryAt)}</dd>
                </div>
                <div className="col-span-2 flex items-start gap-1.5">
                  <Package className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <dd>{current.cargoType} × {current.quantity}（{current.clientName}）</dd>
                </div>
              </dl>
              <DriverStatusActions orderId={current.id} orderNo={current.orderNo} status={current.status} />
              <div className="grid grid-cols-2 gap-2">
                <Button asChild variant="outline" size="lg">
                  <a href={directionsUrl(current.status === "assigned" ? current.pickupAddress : current.deliveryAddress)} target="_blank" rel="noopener noreferrer">
                    <Navigation aria-hidden />
                    {current.status === "assigned" ? "集荷先へ案内" : "配送先へ案内"}
                  </a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href={`/driver/orders/${current.id}`}>詳細を見る</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <PartyPopper className="size-8 text-success" aria-hidden />
            <p className="font-semibold">{orders.length > 0 ? "本日の配送はすべて完了しました" : "本日の担当はありません"}</p>
            <p className="text-sm text-muted-foreground">新しい配送が割り当てられると、ここと通知に表示されます。</p>
          </CardContent>
        </Card>
      )}

      {remaining.length > 1 && (
        <section className="space-y-2" aria-labelledby="after-heading">
          <div className="flex items-center justify-between">
            <h2 id="after-heading" className="text-sm font-semibold text-muted-foreground">このあとの配送</h2>
            <Link href="/driver/orders" className="flex items-center gap-0.5 text-sm text-brand">
              すべて見る<ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="grid gap-2">
            {remaining.filter((o) => o.id !== current?.id).slice(0, 3).map((o) => <DriverOrderCardLink key={o.id} order={o} />)}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-2" aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading" className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <CalendarCheck className="size-4" aria-hidden />明日以降の予定
          </h2>
          <div className="grid gap-2">
            {upcoming.map((o) => <DriverOrderCardLink key={o.id} order={o} showDate />)}
          </div>
        </section>
      )}

      <Card>
        <CardContent className="grid grid-cols-3 divide-x pt-5 text-center">
          <div>
            <p className="text-xs text-muted-foreground">今月の完了</p>
            <p className="text-xl font-bold tabular">{month.delivered}<span className="text-sm font-normal">件</span></p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">うち遅れ</p>
            <p className="text-xl font-bold tabular">{month.late}<span className="text-sm font-normal">件</span></p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">配送失敗</p>
            <p className="text-xl font-bold tabular">{month.failed}<span className="text-sm font-normal">件</span></p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
