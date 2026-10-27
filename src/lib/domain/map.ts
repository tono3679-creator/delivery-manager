/**
 * 地図のマーカーの区分（仕様：青＝配送予定、オレンジ＝配送中、緑＝配送完了、赤＝配送遅延）。
 * 遅延は「まだ届けていない案件」が予定を過ぎたときだけ赤にする。遅れて完了した案件は完了（緑）で、吹き出しに「遅れて完了」と出す。
 * 配送失敗は仕様の4色に含まれないため灰色で区別する。キャンセルは地図に出さない。
 */
import type { OrderStatus } from "./status";

export const MAP_STATES = ["planned", "in_transit", "late", "delivered", "failed"] as const;
export type MapState = (typeof MAP_STATES)[number];

export const MAP_STATE_LABEL: Record<MapState, string> = {
  planned: "配送予定",
  in_transit: "配送中",
  late: "配送遅延",
  delivered: "配送完了",
  failed: "配送失敗",
};

/** マーカーの色（CSS 変数。色だけで区別しないよう、マーカーの中の記号と凡例の文字も併用する） */
export const MAP_STATE_COLOR: Record<MapState, string> = {
  planned: "var(--brand)",
  in_transit: "var(--warning)",
  late: "var(--destructive)",
  delivered: "var(--success)",
  failed: "var(--muted-foreground)",
};

export function mapState(status: OrderStatus, isLate: boolean): MapState | null {
  switch (status) {
    case "cancelled":
      return null;
    case "failed":
      return "failed";
    case "delivered":
      return "delivered";
    case "picked_up":
    case "in_transit":
      return isLate ? "late" : "in_transit";
    default:
      return isLate ? "late" : "planned";
  }
}
