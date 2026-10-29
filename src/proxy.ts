import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce } from "@/lib/security/csp";

const PUBLIC_PATHS = ["/login", "/api/cron"];
/** src/lib/session.ts と同じ（proxy から DB には問い合わせない） */
const SESSION_COOKIE = "dm_session";
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * すべてのページの前に動く処理。
 *   1. リクエストごとの nonce で Content Security Policy を付ける（Next.js が自分のスクリプトに nonce を付ける）
 *   2. ログインの Cookie が無ければログイン画面へ（API は 401）。
 *      Cookie が本物か・権限があるかは、各画面・処理がサーバーで DB を見て確かめる（src/lib/auth.ts）
 */
export function proxy(request: NextRequest) {
  const csp = buildCsp(createNonce(), { dev: process.env.NODE_ENV === "development" });
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!isPublic && !(token && SESSION_TOKEN_PATTERN.test(token))) {
    // API は画面へ移動させず、401 を返す
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "ログインしてください" }, { status: 401, headers: { "content-security-policy": csp } });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // リクエストヘッダーに CSP を加えて次へ渡す（Next.js が nonce を読む）
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
