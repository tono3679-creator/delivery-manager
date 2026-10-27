/** 取り込みの上限（画面でも使うため、CSV の読み取り処理とは分けて置く） */

/** 一度に取り込める行数（多すぎる取り込みで処理が長引かないように） */
export const ORDER_IMPORT_MAX_ROWS = 500;
/** 取り込めるファイルの大きさ（バイト）。500 行なら Shift_JIS・UTF-16 でも十分に収まり、送信の上限（1MB）にもかからない */
export const ORDER_IMPORT_MAX_BYTES = 512 * 1024;
