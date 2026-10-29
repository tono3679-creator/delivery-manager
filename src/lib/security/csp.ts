import { mapTileUrl } from "@/lib/map-config";

/** URL のオリジン（地図タイルの {s} サブドメインはワイルドカードにする）。不正な値なら null */
function originOf(url: string): string | null {
  try {
    const u = new URL(url.replace(/\{s\}\./, "a."));
    const origin = `${u.protocol}//${u.host}`;
    return url.includes("{s}.") ? origin.replace("//a.", "//*.") : origin;
  } catch {
    return null;
  }
}

/**
 * Content Security Policy。
 *   スクリプトはリクエストごとの nonce が付いたもの（とそこから読み込まれたもの）だけ実行する。
 *   通信先は自分のサイトだけ、画像は地図タイルの配信元だけ許可する。
 *   ほかのサイトの iframe に埋め込ませない（クリックジャッキング対策）。
 */
export function buildCsp(nonce: string, options: { dev: boolean }): string {
  const tiles = originOf(mapTileUrl);
  const directives: Record<string, (string | null | undefined | false)[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", options.dev && "'unsafe-eval'"],
    // React の style 属性・地図・グラフのインラインスタイルのため
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", tiles],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values.filter(Boolean)].join(" "))
    .join("; ");
}

/** 推測できない nonce（リクエストごとに作る） */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
