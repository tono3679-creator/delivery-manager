import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ExternalLink, Mail, MapPin, NotebookPen, Phone, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BackLink, DetailItem, MiniStat, Muted } from "@/components/common/detail";
import { MonthlyRevenueChart } from "@/components/analytics/charts";
import { ClientFormButton } from "@/components/masters/client-form";
import { DeleteMasterButton } from "@/components/masters/delete-master-button";
import { RecentOrders } from "@/components/masters/recent-orders";
import { asAdmin } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { getClientDetail } from "@/lib/data/clients";
import { formatDate, formatNumber, formatYen } from "@/lib/format";
import { mapSearchUrl, telUrl } from "@/lib/maps";

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "荷主詳細" };

export default async function ClientDetailPage({ params }: Props) {
  const { id } = await params;
  const today = todayJst();
  const client = await asAdmin((tx) => getClientDetail(tx, id, today));
  if (!client) notFound();

  const thisMonth = client.series.at(-1);
  const lastMonth = client.series.at(-2);
  const sixMonthRevenue = client.series.reduce((s, p) => s + p.revenue, 0);
  const sixMonthDelivered = client.series.reduce((s, p) => s + p.delivered, 0);
  const month = Number(today.slice(5, 7));
  const prevMonth = month === 1 ? 12 : month - 1;

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <BackLink href="/clients" label="荷主一覧" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{client.name}</h1>
            <p className="text-sm text-muted-foreground tabular">
              {client.code}・案件 {formatNumber(client.totalOrders, "件")}
              {client.activeOrders > 0 && `（対応中 ${client.activeOrders}件）`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href={`/orders?client=${client.id}`}>案件を見る</Link></Button>
            <ClientFormButton
              variant="edit"
              id={client.id}
              code={client.code}
              initial={{
                name: client.name, contactName: client.contactName ?? "", phone: client.phone ?? "", email: client.email ?? "",
                address: client.address ?? "", startedOn: client.startedOn ?? "", notes: client.notes ?? "",
              }}
            />
            <DeleteMasterButton
              kind="client"
              id={client.id}
              name={client.name}
              redirectTo="/clients"
              disabledReason={client.totalOrders > 0 ? `案件が${client.totalOrders}件あるため削除できません。売上の履歴を残すため、取引が終わった荷主もそのまま残してください。` : undefined}
            />
          </div>
        </div>
      </div>

      <section aria-label="売上の概要" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label={`${month}月の売上`} value={formatYen(thisMonth?.revenue ?? 0)} sub={`${month}月1日〜本日・配送完了分`} />
        <MiniStat label={`${prevMonth}月の売上`} value={formatYen(lastMonth?.revenue ?? 0)} />
        <MiniStat label="直近6か月の売上" value={formatYen(sixMonthRevenue)} sub={`配送完了 ${formatNumber(sixMonthDelivered, "件")}`} />
        <MiniStat label="平均単価" value={sixMonthDelivered === 0 ? "—" : formatYen(Math.round(sixMonthRevenue / sixMonthDelivered))} sub="直近6か月・1件あたり" />
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>月別の売上（直近6か月）</CardTitle>
            </CardHeader>
            <CardContent>
              <MonthlyRevenueChart data={client.series} label={`${client.name}の月別売上の棒グラフ`} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>案件（配送予定の新しい順）</CardTitle>
              <Button asChild variant="ghost" size="sm"><Link href={`/orders?client=${client.id}`}>すべて見る</Link></Button>
            </CardHeader>
            <div className="pb-2">
              <RecentOrders empty="まだ案件はありません" rows={client.recent.map((o) => ({ ...o, sub: o.driverName ?? "未割当" }))} />
            </div>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader><CardTitle>取引先情報</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid gap-3.5 text-sm">
              <DetailItem icon={UserRound} label="担当者">{client.contactName ?? <Muted />}</DetailItem>
              <DetailItem icon={Phone} label="電話番号">
                {client.phone ? <a href={telUrl(client.phone)} className="text-brand hover:underline tabular">{client.phone}</a> : <Muted />}
              </DetailItem>
              <DetailItem icon={Mail} label="メールアドレス">{client.email ?? <Muted />}</DetailItem>
              <DetailItem icon={MapPin} label="住所（集荷先）">
                {client.address ? (
                  <a href={mapSearchUrl(client.address)} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-brand hover:underline">
                    {client.address}
                    <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-label="地図を開く" />
                  </a>
                ) : <Muted />}
              </DetailItem>
              <DetailItem icon={CalendarDays} label="取引開始日">{client.startedOn ? formatDate(client.startedOn) : <Muted />}</DetailItem>
              {client.notes && <DetailItem icon={NotebookPen} label="メモ"><span className="whitespace-pre-wrap">{client.notes}</span></DetailItem>}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
