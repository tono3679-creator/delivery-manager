import Link from "next/link";
import { Building, Clock, FlaskConical, History, KeyRound, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DetailItem, Muted } from "@/components/common/detail";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { DeleteMasterButton } from "@/components/masters/delete-master-button";
import { CompanyNameForm } from "@/components/settings/company-name-form";
import { DemoResetButton } from "@/components/settings/demo-reset-button";
import { OfficeFormButton } from "@/components/settings/office-form";
import { asAdmin } from "@/lib/auth";
import {
  AUDIT_PAGE_SIZE, getCompanySettings, listAuditLogs, listOffices, parseAuditParams, type AuditParams,
} from "@/lib/data/settings";
import {
  AUDIT_ACTION_LABEL, AUDIT_ENTITY_LABEL, AUDIT_FILTERS, auditHref, describeAudit, type AuditRow,
} from "@/lib/domain/audit";
import { formatDateTime, formatDateTimeFull } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "設定" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = parseAuditParams(await searchParams);
  const { user, company, offices, logs } = await asAdmin(async (tx, user) => {
    const [company, offices, logs] = await Promise.all([getCompanySettings(tx), listOffices(tx), listAuditLogs(tx, params)]);
    return { user, company, offices, logs };
  });
  const hoursLeft = company?.demoHoursLeft ?? null;

  return (
    <div className="space-y-5">
      <PageHeader title="設定" description="会社の情報と営業所を管理し、誰がいつ何を操作したかを確認できます。" />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><Building className="size-4 text-muted-foreground" aria-hidden />会社情報</CardTitle>
              <CardDescription className="mt-1">会社名はサイドバーと画面上部に表示されます。</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <CompanyNameForm name={company?.name ?? user.companyName} />
            {company?.isDemo && (
              <div className="space-y-3 rounded-lg border border-warning/40 bg-warning-soft/50 p-4">
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <DetailItem icon={FlaskConical} label="環境">デモ環境（あなた専用）</DetailItem>
                  <DetailItem icon={Clock} label="自動で削除される日時">
                    <span className="tabular">{formatDateTimeFull(company.demoExpiresAt)}</span>
                    {hoursLeft !== null && <span className="text-muted-foreground">（あと約{hoursLeft}時間）</span>}
                  </DetailItem>
                </dl>
                <p className="text-keep text-xs text-muted-foreground">
                  データはすべて架空です。操作して内容が変わっても、ほかの閲覧者には影響しません。
                </p>
                <DemoResetButton />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><UserRound className="size-4 text-muted-foreground" aria-hidden />ログイン中のアカウント</CardTitle>
              <CardDescription className="mt-1">操作履歴にはこの名前で記録されます。</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <DetailItem icon={UserRound} label="表示名">{user.displayName}</DetailItem>
              <DetailItem icon={ShieldCheck} label="権限">
                管理者<span className="block text-xs text-muted-foreground">すべての画面と操作を利用できます</span>
              </DetailItem>
              <DetailItem icon={KeyRound} label="ログイン方法" className="sm:col-span-2">
                {user.isAnonymous ? "デモ用の一時アカウント（メールアドレスの登録なし）" : "メールアドレスとパスワード"}
              </DetailItem>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" aria-hidden />営業所</CardTitle>
            <CardDescription className="mt-1">ドライバーの所属先です。所属しているドライバーがいる営業所は削除できません。</CardDescription>
          </div>
          <OfficeFormButton />
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {offices.length === 0 ? (
            <EmptyState icon={MapPin} title="営業所はまだ登録されていません" description="「営業所を追加」から登録すると、ドライバーの所属先として選べます。" />
          ) : (
            <ul className="divide-y border-t">
              {offices.map((o) => (
                <li key={o.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{o.name}</p>
                    <p className="text-sm break-words text-muted-foreground">{o.address}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <Link href={`/drivers?office=${o.id}`} className="text-sm whitespace-nowrap text-brand hover:underline">
                      所属ドライバー <span className="tabular font-semibold">{o.drivers}</span>名
                    </Link>
                    <div className="flex items-center">
                      <OfficeFormButton id={o.id} initial={{ name: o.name, address: o.address }} />
                      <DeleteMasterButton
                        kind="office"
                        id={o.id}
                        name={o.name}
                        redirectTo="/settings"
                        disabledReason={
                          o.allDrivers > 0
                            ? `所属しているドライバー（退職者を含めて${o.allDrivers}名）がいるため削除できません。先にドライバーの所属営業所を変更してください。`
                            : undefined
                        }
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card id="audit" className="scroll-mt-20">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2"><History className="size-4 text-muted-foreground" aria-hidden />操作履歴</CardTitle>
            <CardDescription className="mt-1">
              案件の登録・配車・マスタの変更・CSV の入出力・請求などを記録しています。案件のステータスの変更は各案件の詳細で確認できます。
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <AuditFilterTabs current={params.log} />
          {logs.rows.length === 0 ? (
            <EmptyState icon={History} title="この条件の操作履歴はありません" description="案件の登録や配車などを行うと、ここに記録されます。" />
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32 pl-5">日時</TableHead>
                      <TableHead className="w-36">操作した人</TableHead>
                      <TableHead className="w-48">操作</TableHead>
                      <TableHead className="pr-5">内容</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="pl-5 tabular whitespace-nowrap">{formatDateTime(r.at)}</TableCell>
                        <TableCell className="whitespace-nowrap">{r.actorName ?? <Muted />}</TableCell>
                        <TableCell><AuditActionBadge row={r} /></TableCell>
                        <TableCell className="pr-5"><AuditSummary row={r} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="divide-y md:hidden">
                {logs.rows.map((r) => (
                  <li key={r.id} className="space-y-1 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <AuditActionBadge row={r} />
                      <span className="shrink-0 text-xs text-muted-foreground tabular">{formatDateTime(r.at)}</span>
                    </div>
                    <div className="text-sm"><AuditSummary row={r} /></div>
                    <p className="text-xs text-muted-foreground">{r.actorName ?? "—"}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="border-t">
            <Pagination
              page={logs.page}
              pageCount={logs.pageCount}
              total={logs.total}
              pageSize={AUDIT_PAGE_SIZE}
              hrefFor={(page) => auditHrefFor(params, { page })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function auditHrefFor(current: AuditParams, next: Partial<AuditParams>): string {
  const p = { ...current, ...next };
  const qs = new URLSearchParams();
  if (p.log) qs.set("log", p.log);
  if (p.page > 1) qs.set("page", String(p.page));
  const query = qs.toString();
  return `/settings${query ? `?${query}` : ""}#audit`;
}

function AuditFilterTabs({ current }: { current: AuditParams["log"] }) {
  return (
    <nav aria-label="操作履歴の絞り込み" className="flex gap-1.5 overflow-x-auto border-t px-4 py-2.5 sm:px-5">
      {AUDIT_FILTERS.map((f) => (
        <Link
          key={f.key}
          href={auditHrefFor({ log: f.key, page: 1 }, {})}
          aria-current={current === f.key ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1 text-sm whitespace-nowrap transition-colors",
            current === f.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
          )}
        >
          {f.label}
        </Link>
      ))}
    </nav>
  );
}

function AuditActionBadge({ row }: { row: AuditRow }) {
  const variant = row.action === "delete" || row.action === "cancel" ? "danger" : row.action === "create" || row.action === "import" ? "success" : "neutral";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-sm">{AUDIT_ENTITY_LABEL[row.entity] ?? row.entity}</span>
      <Badge variant={variant}>{AUDIT_ACTION_LABEL[row.action] ?? row.action}</Badge>
    </span>
  );
}

function AuditSummary({ row }: { row: AuditRow }) {
  const text = describeAudit(row) || "—";
  const href = auditHref(row);
  return href ? (
    <Link href={href} className="break-words text-brand hover:underline">{text}</Link>
  ) : (
    <span className="break-words">{text}</span>
  );
}
