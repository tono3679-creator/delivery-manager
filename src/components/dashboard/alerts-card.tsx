import Link from "next/link";
import { AlarmClock, ChevronRight, CircleDashed, ShieldAlert, Wrench, CircleCheckBig } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardAlerts } from "@/lib/data/dashboard";
import { formatDate, formatDaysLeft, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Item = { href: string; icon: typeof AlarmClock; tone: "danger" | "warning"; title: string; detail: string };

export function AlertsCard({ alerts }: { alerts: DashboardAlerts }) {
  const items: Item[] = [];
  if (alerts.lateCount > 0) {
    items.push({
      href: "/orders?late=1&scope=active", icon: AlarmClock, tone: "danger",
      title: `配送遅延 ${alerts.lateCount}件`,
      detail: alerts.lateOrders.slice(0, 2).map((o) => `${formatTime(o.deliveryAt)} ${o.deliveryName}`).join("、"),
    });
  }
  if (alerts.unassignedToday + alerts.unassignedUpcoming > 0) {
    items.push({
      href: "/dispatch", icon: CircleDashed, tone: alerts.unassignedToday > 0 ? "danger" : "warning",
      title: `未割当の案件 本日${alerts.unassignedToday}件`,
      detail: `今後7日間でさらに${alerts.unassignedUpcoming}件が未割当です`,
    });
  }
  for (const v of alerts.inspection) {
    items.push({
      href: `/vehicles/${v.id}`, icon: Wrench, tone: v.days < 0 ? "danger" : "warning",
      title: `車検${v.days < 0 ? "期限切れ" : "期限が近い"}：${v.plate}`,
      detail: `満了日 ${formatDate(v.date)}（${formatDaysLeft(v.days)}）`,
    });
  }
  for (const v of alerts.insurance) {
    items.push({
      href: `/vehicles/${v.id}`, icon: ShieldAlert, tone: v.days < 0 ? "danger" : "warning",
      title: `保険${v.days < 0 ? "期限切れ" : "期限が近い"}：${v.plate}`,
      detail: `満了日 ${formatDate(v.date)}（${formatDaysLeft(v.days)}）`,
    });
  }
  items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "danger" ? -1 : 1));

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>アラート</CardTitle>
        <span className="text-xs text-muted-foreground">{items.length}件</span>
      </CardHeader>
      <CardContent className="flex-1">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
            <CircleCheckBig className="size-6 text-success" aria-hidden />
            対応が必要な項目はありません
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {items.map((item, i) => (
              <li key={i}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50",
                    item.tone === "danger" ? "border-destructive/25 bg-danger-soft/50" : "border-warning/30 bg-warning-soft/50",
                  )}
                >
                  <item.icon className={cn("mt-0.5 size-4 shrink-0", item.tone === "danger" ? "text-destructive" : "text-warning-strong")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-keep text-sm font-semibold">
                      <span className="sr-only">{item.tone === "danger" ? "重要：" : "注意："}</span>
                      {item.title}
                    </div>
                    {item.detail && <div className="line-clamp-2 text-xs text-muted-foreground">{item.detail}</div>}
                  </div>
                  <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
