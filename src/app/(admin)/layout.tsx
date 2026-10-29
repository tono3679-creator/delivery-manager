import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminHeader } from "@/components/layout/admin-header";
import { DemoBanner } from "@/components/layout/demo-banner";
import { LateAlertSync } from "@/components/realtime/late-alert-sync";
import { OfflineBanner, RealtimeRefresher } from "@/components/realtime/realtime-refresher";
import { requireAdmin } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { getNotifications } from "@/lib/data/notifications";
import { formatDateLong } from "@/lib/format";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const notifications = await asUser(user.userId, (tx) => getNotifications(tx, "admin", null));
  return (
    <RealtimeRefresher syncedAt={new Date().toISOString()}>
      <LateAlertSync />
      <div className="min-h-dvh">
        <AdminSidebar companyName={user.companyName} />
        <div className="flex min-h-dvh flex-col lg:pl-60">
          {user.isDemo && <DemoBanner role="admin" />}
          <AdminHeader
            today={formatDateLong(new Date())}
            displayName={user.displayName}
            companyName={user.companyName}
            isDemo={user.isDemo}
            notifications={notifications.items}
            unreadCount={notifications.unread}
          />
          <OfflineBanner className="sm:px-6" />
          <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>
        </div>
      </div>
    </RealtimeRefresher>
  );
}
