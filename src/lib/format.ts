/** 日本向けの表示形式（すべて日本時間） */

const TZ = "Asia/Tokyo";

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("ja-JP");
const dateLong = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, year: "numeric", month: "long", day: "numeric", weekday: "short" });
const dateShort = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, month: "numeric", day: "numeric", weekday: "short" });
const dateNumeric = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const time = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const dateTimeFull = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

function toDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  // 'YYYY-MM-DD' は日本時間の日付として扱う
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00+09:00`);
  return new Date(value);
}

export function formatYen(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : yen.format(value);
}

/** グラフの軸などに使う短い金額（例：1,234万円） */
export function formatYenCompact(value: number): string {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}億円`;
  if (Math.abs(value) >= 10_000) return `${num.format(Math.round(value / 10_000))}万円`;
  return `${num.format(value)}円`;
}

export function formatNumber(value: number | null | undefined, unit = ""): string {
  return value === null || value === undefined ? "—" : `${num.format(value)}${unit}`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(digits)}%`;
}

export function formatSignedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/** 2026年10月27日(火) */
export function formatDateLong(value: Date | string): string {
  return dateLong.format(toDate(value));
}
/** 10/27(火) */
export function formatDateShort(value: Date | string): string {
  return dateShort.format(toDate(value));
}
/** 2026/10/27 */
export function formatDate(value: Date | string | null | undefined): string {
  return value ? dateNumeric.format(toDate(value)) : "—";
}
/** 09:30 */
export function formatTime(value: Date | string | null | undefined): string {
  return value ? time.format(toDate(value)) : "—";
}
/** 10/27 09:30 */
export function formatDateTime(value: Date | string | null | undefined): string {
  return value ? dateTime.format(toDate(value)) : "—";
}
/** 2026/10/27 09:30 */
export function formatDateTimeFull(value: Date | string | null | undefined): string {
  return value ? dateTimeFull.format(toDate(value)) : "—";
}

/** 期限までの日数の表示（例：あと12日 / 3日超過） */
export function formatDaysLeft(days: number): string {
  if (days < 0) return `${Math.abs(days)}日超過`;
  if (days === 0) return "本日まで";
  return `あと${days}日`;
}
