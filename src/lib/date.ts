/**
 * 日付ユーティリティ。業務日付はすべて日本時間（Asia/Tokyo, UTC+9・夏時間なし）で扱う。
 * 「日付」は 'YYYY-MM-DD' 文字列、「日時」は Date（UTC の瞬間）で表す。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DateString = string;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** 日時を日本時間の日付文字列にする */
export function toJstDate(at: Date): DateString {
  const j = new Date(at.getTime() + JST_OFFSET_MS);
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}`;
}

/** 日本時間の「その日の0時からの分」 */
export function jstMinutesOfDay(at: Date): number {
  const j = new Date(at.getTime() + JST_OFFSET_MS);
  return j.getUTCHours() * 60 + j.getUTCMinutes();
}

/** 日本時間の日付＋その日の分 → 日時 */
export function jstDateTime(day: DateString, minutesOfDay = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - JST_OFFSET_MS + minutesOfDay * 60_000);
}

/** その日の日本時間 0:00 */
export function jstStartOfDay(day: DateString): Date {
  return jstDateTime(day, 0);
}

export function addDays(day: DateString, days: number): DateString {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000);
}

/** 0 = 日曜 … 6 = 土曜 */
export function dayOfWeek(day: DateString): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(from: DateString, to: DateString): number {
  return Math.round((jstStartOfDay(to).getTime() - jstStartOfDay(from).getTime()) / DAY_MS);
}

export function startOfMonth(day: DateString): DateString {
  return `${day.slice(0, 7)}-01`;
}

export function endOfMonth(day: DateString): DateString {
  const [y, m] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${day.slice(0, 7)}-${pad(last)}`;
}

export function addMonths(day: DateString, months: number): DateString {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, lastDay))}`;
}

/** 'YYYY-MM-DD' として正しい日付か */
export function isDateString(value: string): value is DateString {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function todayJst(now: Date = new Date()): DateString {
  return toJstDate(now);
}

/** 日本の祝日（2026〜2027年）。配送件数の生成と営業日の判定に使う */
const HOLIDAYS = new Set<DateString>([
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29",
  "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06", "2026-07-20", "2026-08-11",
  "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
  "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22",
  "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05", "2027-07-19", "2027-08-11",
  "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23",
]);

export function isHoliday(day: DateString): boolean {
  return HOLIDAYS.has(day);
}
