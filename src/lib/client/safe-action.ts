import { unstable_rethrow } from "next/navigation";

export const NETWORK_ERROR_MESSAGE = "通信できませんでした。接続を確認してから、もう一度お試しください";
export const UNEXPECTED_ERROR_MESSAGE = "処理を完了できませんでした。時間をおいて再度お試しください";

/** 例外を受け止めたときの結果（各 Action の失敗の形に合わせて、項目別エラーなどは空） */
export type ActionFailure = { ok: false; error: string; fieldErrors?: Record<string, string>; stale?: true };

/**
 * 画面から Server Action を呼ぶ。通信が切れたときやサーバーで想定外のエラーが起きたときも、
 * 例外のまま放置せず { ok: false, error } にして、画面にメッセージを出せるようにする。
 * リダイレクト（ログイン後の移動など）は Next.js に任せるため、そのまま投げ直す。
 */
export async function safeAction<T>(call: () => Promise<T>): Promise<T | ActionFailure> {
  try {
    return await call();
  } catch (e) {
    unstable_rethrow(e);
    console.error(e);
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return { ok: false, error: offline || e instanceof TypeError ? NETWORK_ERROR_MESSAGE : UNEXPECTED_ERROR_MESSAGE };
  }
}
