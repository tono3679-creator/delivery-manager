/** 配送失敗・キャンセル理由の入力候補（自由入力も可） */
export const FAILURE_REASONS = [
  "受取人不在のため持ち戻り",
  "納品先の受付時間外のため持ち戻り",
  "荷姿不良のため受取拒否",
  "住所不明のため荷主へ確認中",
] as const;

export const CANCEL_REASONS = ["荷主都合によるキャンセル", "納品日の変更", "発注内容の誤り"] as const;
