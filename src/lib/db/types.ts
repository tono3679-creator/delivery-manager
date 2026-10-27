/** postgres.js の型変換（アプリとテストで共通） */
export const DB_TYPES = {
  // numeric（金額）は文字列ではなく数値で受け取る。円単位の整数なので誤差は出ない
  numeric: { to: 1700, from: [1700], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
  // bigint（count の結果）も数値で受け取る
  bigint: { to: 20, from: [20], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
  // date（業務日付）は 'YYYY-MM-DD' の文字列のまま扱う（タイムゾーンのずれを防ぐ）
  date: { to: 1082, from: [1082], serialize: (v: string) => v, parse: (v: string) => v },
};
