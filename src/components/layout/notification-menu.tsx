"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlarmClock, Ban, Bell, CircleCheckBig, CircleX, Clock, Info, MessageSquareText, UserCheck, UserMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { markNotificationRead } from "@/lib/actions/notifications";
import { markNotificationsRead } from "@/lib/actions/session";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  read: boolean;
};

const ICON: Record<string, typeof Bell> = {
  delivered: CircleCheckBig, failed: CircleX, assigned: UserCheck, unassigned: UserMinus, rescheduled: Clock,
  late: AlarmClock, cancelled: Ban, note: MessageSquareText,
};
const COLOR: Record<string, string> = {
  delivered: "text-success", failed: "text-destructive", assigned: "text-brand", unassigned: "text-muted-foreground",
  rescheduled: "text-warning-strong", late: "text-destructive", cancelled: "text-muted-foreground", note: "text-brand",
};
/** 届いたときのお知らせ（トースト）の種類 */
const TOAST: Record<string, "success" | "error" | "warning" | "info"> = {
  delivered: "success", failed: "error", late: "warning", cancelled: "warning", unassigned: "warning", rescheduled: "warning",
};

/**
 * ヘッダーの通知。新しい通知が届いたら（リアルタイム更新・定期更新で一覧が変わったら）トーストでも知らせる。
 */
export function NotificationMenu({
  items, unreadCount, audience,
}: { items: NotificationItem[]; unreadCount: number; audience: "admin" | "driver" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  // 開いた通知はすぐ既読の表示にする（次に画面を更新したときに DB の内容でそろう）
  const [readNow, setReadNow] = useState<Set<string>>(() => new Set());
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    // 最初の表示では知らせない（すでにある通知はベルの未読数で分かる）
    if (seen.current === null) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    const known = seen.current;
    const fresh = items.filter((n) => !n.read && !known.has(n.id));
    items.forEach((n) => known.add(n.id));
    if (fresh.length === 0) return;
    if (fresh.length > 2) {
      toast.info(`新しい通知が ${fresh.length} 件あります`, {
        description: fresh.slice(0, 2).map((n) => n.title).join("、"),
        action: { label: "通知を見る", onClick: () => setOpen(true) },
      });
      return;
    }
    for (const n of fresh) {
      const show = toast[TOAST[n.kind] ?? "info"];
      show(n.title, {
        description: n.body ?? undefined,
        action: n.link ? { label: "開く", onClick: () => { setReadNow((s) => new Set(s).add(n.id)); void markNotificationRead(n.id); router.push(n.link!); } } : undefined,
      });
    }
  }, [items, router]);

  const unread = Math.max(0, unreadCount - items.filter((n) => !n.read && readNow.has(n.id)).length);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`通知（未読 ${unread} 件）`}>
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-1rem)]">
        <div className="flex items-center justify-between">
          <DropdownMenuLabel>通知</DropdownMenuLabel>
          {unread > 0 && (
            <Button
              variant="link"
              size="sm"
              disabled={pending}
              onClick={() => startTransition(() => markNotificationsRead(audience))}
            >
              すべて既読にする
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">新しい通知はありません</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((n) => {
              const Icon = ICON[n.kind] ?? Info;
              const read = n.read || readNow.has(n.id);
              const content = (
                <div className="flex w-full gap-2.5">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", COLOR[n.kind] ?? "text-muted-foreground")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      {!read && <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-label="未読" />}
                      <span className="min-w-0">{n.title}</span>
                    </div>
                    {n.body && <div className="truncate text-xs text-muted-foreground">{n.body}</div>}
                    <div className="mt-0.5 text-[11px] text-muted-foreground tabular">{formatDateTime(n.createdAt)}</div>
                  </div>
                </div>
              );
              const markRead = () => {
                if (read) return;
                setReadNow((s) => new Set(s).add(n.id));
                void markNotificationRead(n.id);
              };
              return (
                <DropdownMenuItem key={n.id} asChild={Boolean(n.link)} className="items-start" onSelect={markRead}>
                  {n.link ? <Link href={n.link}>{content}</Link> : content}
                </DropdownMenuItem>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
