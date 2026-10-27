import { DemoBanner } from "@/components/layout/demo-banner";
import { DriverBottomNav } from "@/components/layout/driver-nav";
import { NotificationMenu } from "@/components/layout/notification-menu";
import { UserMenu } from "@/components/layout/user-menu";
import { Logo } from "@/components/layout/logo";
import { OfflineBanner, RealtimeRefresher } from "@/components/realtime/realtime-refresher";
import { requireDriver } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { getNotifications } from "@/lib/data/notifications";
import { getOwnLocationSharing } from "@/lib/data/driver-positions";
import { LocationSharingIndicator, LocationSharingProvider } from "@/components/driver/location-sharing";

export const metadata = { title: "ドライバー" };

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const user = await requireDriver();
  const { notifications, sharingSince } = await asUser(user.userId, async (tx) => {
    const [notifications, sharingSince] = await Promise.all([getNotifications(tx, "driver", user.driverId), getOwnLocationSharing(tx, user.driverId)]);
    return { notifications, sharingSince };
  });
  return (
    <RealtimeRefresher syncedAt={new Date().toISOString()}>
      <LocationSharingProvider initiallySharing={sharingSince !== null}>
        <div className="min-h-dvh bg-background pb-[calc(4rem+env(safe-area-inset-bottom))]">
          {user.isDemo && <DemoBanner role="driver" className="sticky top-0 z-30" />}
          <header className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
            <Logo tagline={false} />
            <div className="flex items-center gap-1">
              <LocationSharingIndicator />
              <NotificationMenu items={notifications.items} unreadCount={notifications.unread} audience="driver" />
              <UserMenu displayName={user.displayName} roleLabel="ドライバー" isDemo={user.isDemo} role="driver" />
            </div>
          </header>
          <OfflineBanner className="mx-auto mb-3 max-w-md rounded-lg" />
          <main className="mx-auto max-w-md px-4 pb-6">{children}</main>
          <DriverBottomNav />
        </div>
      </LocationSharingProvider>
    </RealtimeRefresher>
  );
}
