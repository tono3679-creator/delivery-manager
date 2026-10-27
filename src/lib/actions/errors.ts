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

/** zod の検証エラーを「項目名 → 最初のメッセージ」にする（フォームの項目下に表示する） */
export function toFieldErrors(error: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/** 一意制約違反か（constraint 名の一部で判定） */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; constraint_name?: string; constraint?: string };
  return e.code === "23505" && (e.constraint_name ?? e.constraint ?? "").includes(constraint);
}
