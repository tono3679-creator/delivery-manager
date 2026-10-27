"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, isActive } from "./nav";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="メインメニュー" className="flex flex-col gap-0.5 px-3">
      {ADMIN_NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-white shadow-[inset_3px_0_0_var(--brand)]"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
            )}
          >
            <item.icon className={cn("size-4.5 shrink-0", active ? "text-white" : "text-sidebar-muted group-hover:text-white")} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarBody({ companyName, onNavigate }: { companyName: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 pt-5 pb-6">
        <Logo inverted tagline={false} />
      </div>
      <SidebarNav onNavigate={onNavigate} />
      <div className="mt-auto border-t border-sidebar-border px-5 py-4">
        <div className="text-[11px] text-sidebar-muted">ご利用中の会社</div>
        <div className="text-keep mt-0.5 text-sm font-medium text-white">{companyName}</div>
      </div>
    </div>
  );
}

export function AdminSidebar({ companyName }: { companyName: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">
      <SidebarBody companyName={companyName} />
    </aside>
  );
}
