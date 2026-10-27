import "server-only";
import type { Tx } from "@/lib/db";
import type { NotificationItem } from "@/components/layout/notification-menu";

export async function getNotifications(
  tx: Tx,
  audience: "admin" | "driver",
  driverId: string | null,
): Promise<{ items: NotificationItem[]; unread: number }> {
  const rows = await tx<{ id: string; kind: string; title: string; body: string | null; link: string | null; created_at: Date; read_at: Date | null }[]>`
    select id, kind, title, body, link, created_at, read_at from notifications
     where audience = ${audience} ${driverId ? tx`and driver_id = ${driverId}` : tx``}
     order by created_at desc limit 10`;
  const [count] = await tx<{ n: number }[]>`
    select count(*) n from notifications
     where audience = ${audience} and read_at is null ${driverId ? tx`and driver_id = ${driverId}` : tx``}`;
  return {
    items: rows.map((r) => ({
      id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link,
      createdAt: r.created_at.toISOString(), read: r.read_at !== null,
    })),
    unread: count.n,
  };
}
