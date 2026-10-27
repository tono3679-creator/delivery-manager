import { ClipboardList } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { DriverOrderCardLink } from "@/components/driver/order-card";
import { asDriver } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { getDriverDay, getDriverUpcoming } from "@/lib/data/driver";
import { ACTIVE_STATUSES } from "@/lib/domain/status";
import { formatDateLong } from "@/lib/format";

export const metadata = { title: "本日の配送" };

export default async function DriverOrdersPage() {
  const today = todayJst();
  const { orders, upcoming } = await asDriver(async (tx) => {
    const [orders, upcoming] = await Promise.all([getDriverDay(tx, today), getDriverUpcoming(tx, today, 10)]);
    return { orders, upcoming };
  });
  const active = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const finished = orders.filter((o) => !ACTIVE_STATUSES.includes(o.status));

  return (
    <div className="space-y-5 pt-2">
      <div>
        <h1 className="text-xl font-bold">本日の配送</h1>
        <p className="text-sm text-muted-foreground tabular">{formatDateLong(today)}・{orders.length}件（残り {active.length}件）</p>
      </div>

      {orders.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardList} title="本日の担当はありません" description="割り当てがあると通知でお知らせします。" />
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <section className="space-y-2" aria-labelledby="active-heading">
              <h2 id="active-heading" className="text-sm font-semibold text-muted-foreground">これからの配送（集荷予定順）</h2>
              <div className="grid gap-2">{active.map((o) => <DriverOrderCardLink key={o.id} order={o} />)}</div>
            </section>
          )}
          {finished.length > 0 && (
            <section className="space-y-2" aria-labelledby="done-heading">
              <h2 id="done-heading" className="text-sm font-semibold text-muted-foreground">完了・失敗 {finished.length}件</h2>
              <div className="grid gap-2">{finished.map((o) => <DriverOrderCardLink key={o.id} order={o} />)}</div>
            </section>
          )}
        </>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-2" aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading" className="text-sm font-semibold text-muted-foreground">明日以降の予定</h2>
          <div className="grid gap-2">{upcoming.map((o) => <DriverOrderCardLink key={o.id} order={o} showDate />)}</div>
        </section>
      )}
    </div>
  );
}
