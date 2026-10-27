import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce } from "@/lib/security/csp";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";

const PUBLIC_PATHS = ["/login", "/api/cron"];

/**
 * すべてのページの前に動く処理。
 *   1. リクエストごとの nonce で Content Security Policy を付ける（Next.js が自分のスクリプトに nonce を付ける）
 *   2. Supabase のセッション Cookie を更新し、未ログインならログイン画面へ
 */
export async function proxy(request: NextRequest) {
  const csp = buildCsp(createNonce(), { dev: process.env.NODE_ENV === "development" });
  // Cookie を更新したあとのリクエストヘッダーに CSP を加えて次へ渡す
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set("content-security-policy", csp);
    return NextResponse.next({ request: { headers } });
  };

  let response = next();
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
