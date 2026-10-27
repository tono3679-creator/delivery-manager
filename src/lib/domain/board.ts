/** 配車ボードの配置計算（画面とテストで共通） */
import { jstStartOfDay, type DateString } from "@/lib/date";

export const SNAP_MINUTES = 15;
const DEFAULT_START = 7 * 60;
const DEFAULT_END = 21 * 60;

/** その日の 0:00 からの分（前日・翌日にまたがる場合は負の値・1440 超もあり得る） */
export function minutesFromDayStart(day: DateString, at: Date | string): number {
  return Math.round((new Date(at).getTime() - jstStartOfDay(day).getTime()) / 60_000);
}

/** 表示する時間帯。基本は 7:00〜21:00 で、はみ出す案件があれば1時間単位で広げる */
export function boardWindow(day: DateString, items: { pickupAt: string; deliveryAt: string }[]): { start: number; end: number } {
  let start = DEFAULT_START;
  let end = DEFAULT_END;
  for (const o of items) {
    start = Math.min(start, Math.floor(minutesFromDayStart(day, o.pickupAt) / 60) * 60);
    end = Math.max(end, Math.ceil(minutesFromDayStart(day, o.deliveryAt) / 60) * 60);
  }
  return { start: Math.max(0, start), end: Math.min(24 * 60, end) };
}

export function snap(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

/**
 * 重なる予定を縦に並べるための段（レーン）割り当て。
 * 開始順に見て、空いている一番上の段に入れる。
 */
export function assignLanes<T extends { id: string; start: number; end: number }>(items: T[]): { lanes: Map<string, number>; count: number } {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    lanes.set(item.id, lane);
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}

/** 'HH:mm' ⇔ 分 */
export function minutesToHhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function hhmmToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}
