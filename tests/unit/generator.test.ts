import { describe, expect, it } from "vitest";
import { generateDemoData } from "@/lib/demo/generator";

type OrderRow = { id: string; driver_id: string | null; status: string; pickup_at: Date | string; delivery_at: Date | string };

const ms = (v: Date | string) => new Date(v).getTime();
const jstDay = (v: Date | string) => new Date(ms(v) + 9 * 3600_000).toISOString().slice(0, 10);
const jstMinutes = (v: Date | string) => {
  const d = new Date(ms(v) + 9 * 3600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

/** 同じドライバー・同じ日で時間が重なっている案件の数（キャンセルは除く） */
function overlapping(orders: OrderRow[]): number {
  const groups = new Map<string, OrderRow[]>();
  for (const o of orders) {
    if (!o.driver_id || o.status === "cancelled") continue;
    const key = `${o.driver_id}|${jstDay(o.delivery_at)}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const ids = new Set<string>();
  for (const list of groups.values()) {
    for (const a of list) {
      for (const b of list) {
        if (a !== b && ms(a.pickup_at) < ms(b.delivery_at) && ms(b.pickup_at) < ms(a.delivery_at)) ids.add(a.id);
      }
    }
  }
  return ids.size;
}

describe("デモデータの配車", () => {
  // 朝・昼・夜のどの時刻に作っても、配車ボードが重複の警告だらけにならない
  it.each(["00:30", "09:30", "14:30", "23:30"])("%s に作ったデータでは、同じドライバーの予定が重ならない", (time) => {
    const now = new Date(`2026-10-28T${time}:00+09:00`);
    const data = generateDemoData({ seed: 20261027, now, companyId: "00000000-0000-4000-8000-000000000001", isDemo: true });
    const orders = data.orders as unknown as OrderRow[];
    expect(orders.length).toBeGreaterThan(5000);
    expect(overlapping(orders)).toBe(0);
    // 後ろ倒ししても配送予定は 20:00 まで
    expect(Math.max(...orders.map((o) => jstMinutes(o.delivery_at)))).toBeLessThanOrEqual(20 * 60);
  });
});
