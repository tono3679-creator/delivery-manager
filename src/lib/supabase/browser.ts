"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabasePublishableKey, supabaseUrl } from "./config";

let client: SupabaseClient | null = null;

/** ブラウザ用（Realtime の購読だけに使う。データの読み書きはサーバー経由） */
export function getSupabaseBrowserClient(): SupabaseClient {
  client ??= createBrowserClient(supabaseUrl, supabasePublishableKey);
  return client;
}
