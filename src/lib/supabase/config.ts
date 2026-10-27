/** ブラウザにも公開してよい値だけを置く */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
/** Realtime を使うか（ローカルの簡易認証サーバーでは無効） */
export const realtimeEnabled = process.env.NEXT_PUBLIC_REALTIME_ENABLED !== "false";
