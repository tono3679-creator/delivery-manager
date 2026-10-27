/** CSV をファイルとしてダウンロードさせる応答（日本語のファイル名は RFC 5987 の形式でも渡す） */
export function csvResponse(body: string, fileName: string, asciiFallback: string, rowCount?: number): Response {
  return new Response(body, {
    headers: {
      ...(rowCount === undefined ? {} : { "X-Row-Count": String(rowCount) }),
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      // 個人情報を含むため、ブラウザや途中の経路に残さない
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** 'YYYY-MM-DD' → 'YYYYMMDD' */
export function compactDate(day: string): string {
  return day.replaceAll("-", "");
}
