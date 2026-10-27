import "server-only";

/** DB のエラーを利用者向けのメッセージにする（業務ルール違反はそのまま、その他は汎用文言） */
export function toUserMessage(error: unknown, fallback = "保存に失敗しました。時間をおいて再度お試しください"): string {
  if (error && typeof error === "object" && "code" in error) {
    const e = error as { code?: string; message?: string };
    // トリガーや関数が日本語で返す業務エラー
    if (["23514", "23503", "42501", "40001", "02000", "P0002", "22023"].includes(e.code ?? "") && e.message && /[ぁ-んァ-ン一-龥]/.test(e.message)) {
      return e.message;
    }
    if (e.code === "23503") return "関連するデータがあるため操作できません";
    if (e.code === "23505") return "同じ内容のデータが既に存在します";
    if (e.code === "42501") return "この操作を行う権限がありません";
  }
  console.error(error);
  return fallback;
}
