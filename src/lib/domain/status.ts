/** 配送ステータスと遷移ルール。DB の can_transition() と同じ内容（テストで一致を確認）。 */

export const ORDER_STATUSES = [
  "unassigned",
  "assigned",
  "picked_up",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  unassigned: "未割当",
  assigned: "配車済",
  picked_up: "集荷完了",
  in_transit: "配送中",
  delivered: "配送完了",
  failed: "配送失敗",
  cancelled: "キャンセル",
};

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  unassigned: ["assigned", "cancelled"],
  assigned: ["unassigned", "picked_up", "cancelled"],
  picked_up: ["in_transit", "failed"],
  in_transit: ["delivered", "failed"],
  failed: ["assigned", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export const ACTIVE_STATUSES: readonly OrderStatus[] = ["unassigned", "assigned", "picked_up", "in_transit"];
export const FINAL_STATUSES: readonly OrderStatus[] = ["delivered", "cancelled"];

export function isFinal(status: OrderStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

/** ドライバーが自分で進められる操作 */
export type DriverAction = { to: OrderStatus; label: string; requiresNote: boolean };

export function driverActions(status: OrderStatus): DriverAction[] {
  switch (status) {
    case "assigned":
      return [{ to: "picked_up", label: "集荷完了", requiresNote: false }];
    case "picked_up":
      return [
        { to: "in_transit", label: "配送開始", requiresNote: false },
        { to: "failed", label: "配送失敗", requiresNote: true },
      ];
    case "in_transit":
      return [
        { to: "delivered", label: "配送完了", requiresNote: false },
        { to: "failed", label: "配送失敗", requiresNote: true },
      ];
    default:
      return [];
  }
}

/** 遅延判定の猶予（DB の v_order_facts と同じ 15 分） */
export const LATE_GRACE_MINUTES = 15;

export function isLate(
  order: { status: OrderStatus; deliveryAt: Date; completedAt: Date | null },
  now: Date,
): boolean {
  const limit = order.deliveryAt.getTime() + LATE_GRACE_MINUTES * 60_000;
  if (order.status === "delivered") return (order.completedAt?.getTime() ?? 0) > limit;
  if (ACTIVE_STATUSES.includes(order.status)) return now.getTime() > limit;
  return false;
}
