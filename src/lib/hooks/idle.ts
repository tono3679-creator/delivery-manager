"use client";
/**
 * 操作のない状態（離席）の判定。画面の定期的な再取得は、しばらく操作がなければ止める。
 *
 * 画面を開いたまま席を離れても DB への問い合わせが続くと、使っていないのに DB が止まらず
 * （Neon は 5 分間問い合わせがなければ止まり、その間は計算時間を使わない）、無料枠の計算時間を使い切ってしまう。
 * 操作（クリック・キー入力・スクロール・タッチ）や画面への復帰があれば、すぐに再取得して再開する。
 */

/** この時間、操作がなければ離席とみなす */
export const IDLE_AFTER_MS = 10 * 60_000;

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

let lastActivity = Date.now();
const resumeListeners = new Set<() => void>();
let installed = false;

function markActive() {
  const wasIdle = isIdle();
  lastActivity = Date.now();
  if (wasIdle) for (const listener of resumeListeners) listener();
}

function onVisibilityChange() {
  if (document.visibilityState === "visible") markActive();
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  for (const type of ACTIVITY_EVENTS) window.addEventListener(type, markActive, { passive: true, capture: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
}

/** 離席中か（最後の操作から IDLE_AFTER_MS を過ぎたか） */
export function isIdle(now: number = Date.now()): boolean {
  return now - lastActivity > IDLE_AFTER_MS;
}

/** 離席から戻ったとき（離席中に操作があったとき）に呼ぶ。戻り値で解除する */
export function onResume(listener: () => void): () => void {
  install();
  resumeListeners.add(listener);
  return () => {
    resumeListeners.delete(listener);
  };
}

/** 定期的な再取得をしてよいか（画面が表示されていて、通信でき、離席中でない） */
export function shouldPoll(): boolean {
  install();
  return document.visibilityState === "visible" && navigator.onLine && !isIdle();
}
