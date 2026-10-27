import {
  LayoutDashboard, Package, CalendarClock, Users, Truck, Building2, ChartColumn, Settings, Home, ListChecks, History,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const ADMIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/orders", label: "配送案件", icon: Package },
  { href: "/dispatch", label: "配車管理", icon: CalendarClock },
  { href: "/drivers", label: "ドライバー管理", icon: Users },
  { href: "/vehicles", label: "車両管理", icon: Truck },
  { href: "/clients", label: "荷主管理", icon: Building2 },
  { href: "/analytics", label: "売上・分析", icon: ChartColumn },
  { href: "/settings", label: "設定", icon: Settings },
];

export const DRIVER_NAV: NavItem[] = [
  { href: "/driver", label: "ホーム", icon: Home },
  { href: "/driver/orders", label: "本日の配送", icon: ListChecks },
  { href: "/driver/history", label: "配送履歴", icon: History },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/driver") return pathname === "/driver";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function titleFor(pathname: string): string {
  return ADMIN_NAV.find((n) => isActive(pathname, n.href))?.label ?? "Delivery Manager";
}
