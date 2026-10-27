"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DRIVER_NAV, isActive } from "./nav";
import { cn } from "@/lib/utils";

/** ドライバー用の下部ナビゲーション（片手で押せる大きさ） */
export function DriverBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="ドライバーメニュー"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto grid max-w-md grid-cols-3">
        {DRIVER_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                active ? "text-brand" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className={cn("size-6", active && "stroke-[2.4]")} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
