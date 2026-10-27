/**
 * CSV の読み書き（日本語の文字化け対策を含む）。画面・サーバーどちらからも使える純粋な関数だけを置く。
 *
 * 書き出し：UTF-8（BOM 付き）・改行 CRLF。BOM があると Excel で開いても文字化けしない。
 * 読み込み：BOM → UTF-8 → Shift_JIS（Windows-31J）の順に判定する。Excel の「CSV（コンマ区切り）」は Shift_JIS、
 *          「CSV UTF-8」は BOM 付き UTF-8、「Unicode テキスト」は UTF-16（タブ区切り）で保存される。
 */
import Papa from "papaparse";

export type CsvEncoding = "utf-8" | "shift_jis" | "utf-16le";
export type CsvCell = string | number | null | undefined;

export const CSV_BOM = "﻿";

/**
 * 1つのセルを CSV の書式にする。
 * 文字列が = + - @ タブ 改行 で始まる場合は先頭に ' を付け、表計算ソフトで数式として実行されないようにする（CSV インジェクション対策）。
 * 数値はそのまま出す（マイナスの金額などを壊さないため）。
 */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** 見出しと行から CSV 文字列を作る（BOM 付き・CRLF） */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

export class CsvDecodeError extends Error {}

/** ファイルの中身（バイト列）を文字列にする。文字コードは自動で判定する */
export function decodeCsvBytes(input: ArrayBuffer | Uint8Array): { text: string; encoding: CsvEncoding } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    // UTF-8 として正しくない → Shift_JIS とみなす
  }
  try {
    return { text: new TextDecoder("shift_jis", { fatal: true }).decode(bytes), encoding: "shift_jis" };
  } catch {
    throw new CsvDecodeError("文字コードを判定できませんでした。UTF-8 または Shift_JIS の CSV として保存してください");
  }
}

/** CSV 文字列を行の配列にする（1行目は見出し）。区切り文字はコンマ・タブを自動判定。空行は無視する */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy", delimitersToGuess: [",", "\t", ";"] });
  const fatal = result.errors.find((e) => e.type === "Quotes");
  if (fatal) throw new CsvDecodeError(`CSV の形式が正しくありません（${fatal.row !== undefined ? `${fatal.row + 1}行目付近、` : ""}引用符 " の対応が取れていません）`);
  const [header = [], ...rows] = result.data;
  return { header: header.map((h) => normalizeText(h)), rows };
}

/** 表記ゆれをそろえる（全角英数字・全角スペース → 半角、前後の空白を除く） */
export function normalizeText(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** 先頭の ' を外す（書き出し時に付けた数式対策を元に戻す） */
export function unescapeCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}
