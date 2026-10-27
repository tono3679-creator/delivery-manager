"use client";
import Link from "next/link";
import { useTransition } from "react";
import { Bell, CircleCheckBig, CircleX, UserCheck, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const ICON: Record<string, typeof Bell> = { delivered: CircleCheckBig, failed: CircleX, assigned: UserCheck };
const COLOR: Record<string, string> = { delivered: "text-success", failed: "text-destructive", assigned: "text-brand" };

export function NotificationMenu({
  items, unreadCount, audience,
}: { items: NotificationItem[]; unreadCount: number; audience: "admin" | "driver" }) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`通知（未読 ${unreadCount} 件）`}>
          <Bell />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between">
          <DropdownMenuLabel>通知</DropdownMenuLabel>
          {unreadCount > 0 && (
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
              const content = (
                <div className="flex w-full gap-2.5">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", COLOR[n.kind] ?? "text-muted-foreground")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      {!n.read && <span className="size-1.5 rounded-full bg-brand" aria-label="未読" />}
                      {n.title}
                    </div>
                    {n.body && <div className="truncate text-xs text-muted-foreground">{n.body}</div>}
                    <div className="mt-0.5 text-[11px] text-muted-foreground tabular">{formatDateTime(n.createdAt)}</div>
                  </div>
                </div>
              );
              return (
                <DropdownMenuItem key={n.id} asChild={Boolean(n.link)} className="items-start">
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
