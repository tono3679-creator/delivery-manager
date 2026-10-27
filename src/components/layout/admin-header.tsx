"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarBody } from "./admin-sidebar";
import { titleFor } from "./nav";
import { NotificationMenu, type NotificationItem } from "./notification-menu";
import { UserMenu } from "./user-menu";
import { RealtimeIndicator } from "@/components/realtime/realtime-refresher";

export function AdminHeader({
  today, displayName, companyName, isDemo, notifications, unreadCount,
}: {
  today: string;
  displayName: string;
  companyName: string;
  isDemo: boolean;
  notifications: NotificationItem[];
  unreadCount: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="メニューを開く">
          <Menu />
        </Button>
        <SheetContent side="left" aria-describedby={undefined}>
          <SheetTitle className="sr-only">メインメニュー</SheetTitle>
          <SidebarBody companyName={companyName} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold sm:text-lg">{titleFor(pathname)}</div>
        <div className="hidden text-xs text-muted-foreground sm:block">{today}</div>
      </div>
      <RealtimeIndicator className="hidden md:flex" />
      <NotificationMenu items={notifications} unreadCount={unreadCount} audience="admin" />
      <UserMenu displayName={displayName} roleLabel="管理者" isDemo={isDemo} role="admin" />
    </header>
  );
}
