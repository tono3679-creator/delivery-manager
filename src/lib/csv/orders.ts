/**
 * 配送案件の CSV（書き出しの列・取り込みの列と値の読み取り）。DB に触れない部分だけを置く。
 * 取り込みは「新しい案件の登録」だけを行う（既存の案件の更新はしない）。
 */
import { normalizeText, unescapeCell } from "./csv";
import { ORDER_IMPORT_MAX_ROWS } from "./limits";

/** 書き出しの列 */
export const ORDER_EXPORT_HEADER = [
  "案件ID", "荷主コード", "荷主名", "集荷先住所", "配送先名", "配送先住所", "集荷予定日時", "配送予定日時",
  "担当ドライバー", "使用車両", "荷物の種類", "数量", "配送料金", "ステータス", "遅延", "完了日時", "請求番号", "備考", "作成日時", "更新日時",
] as const;

/** 取り込みのひな形の列（書き出した CSV の列名でも取り込める） */
export const ORDER_IMPORT_HEADER = [
  "荷主", "集荷先住所", "配送先名", "配送先住所", "集荷予定日時", "配送予定日時", "担当ドライバー", "車両", "荷物の種類", "数量", "配送料金", "備考",
] as const;

export { ORDER_IMPORT_MAX_BYTES, ORDER_IMPORT_MAX_ROWS } from "./limits";

type Field =
  | "client" | "pickupAddress" | "deliveryName" | "deliveryAddress" | "pickupAt" | "deliveryAt"
  | "driver" | "vehicle" | "cargoType" | "quantity" | "fee" | "notes";

/** 列名の候補（先にあるものを優先する。荷主はコード → 名前の順） */
const ALIASES: Record<Field, string[]> = {
  client: ["荷主コード", "荷主ID", "荷主", "荷主名"],
  pickupAddress: ["集荷先住所", "集荷先"],
  deliveryName: ["配送先名", "届け先名", "納品先名"],
  deliveryAddress: ["配送先住所", "届け先住所", "納品先住所"],
  pickupAt: ["集荷予定日時", "集荷日時"],
  deliveryAt: ["配送予定日時", "配送日時", "納品日時"],
  driver: ["担当ドライバー", "ドライバー", "ドライバーコード"],
  vehicle: ["車両", "使用車両", "車両番号"],
  cargoType: ["荷物の種類", "荷物", "品名"],
  quantity: ["数量", "個数"],
  fee: ["配送料金", "料金", "運賃"],
  notes: ["備考", "メモ"],
};

const REQUIRED: Field[] = ["client", "deliveryName", "deliveryAddress", "pickupAt", "deliveryAt", "cargoType", "quantity", "fee"];

export const FIELD_LABEL: Record<Field, string> = {
  client: "荷主", pickupAddress: "集荷先住所", deliveryName: "配送先名", deliveryAddress: "配送先住所",
  pickupAt: "集荷予定日時", deliveryAt: "配送予定日時", driver: "担当ドライバー", vehicle: "車両",
  cargoType: "荷物の種類", quantity: "数量", fee: "配送料金", notes: "備考",
};

export type ImportRow = {
  /** CSV の行番号（見出しが1行目） */
  line: number;
  client: string;
  pickupAddress: string;
  deliveryName: string;
  deliveryAddress: string;
  /** 'YYYY-MM-DDTHH:mm'（日本時間）。読み取れなければ null、元の文字は raw に残す */
  pickupAt: string | null;
  deliveryAt: string | null;
  driver: string;
  vehicle: string;
  cargoType: string;
  quantity: number | null;
  fee: number | null;
  notes: string;
  raw: { pickupAt: string; deliveryAt: string; quantity: string; fee: string };
};

/**
 * 日時の文字列を 'YYYY-MM-DDTHH:mm' にする。
 * 2026/10/28 9:00、2026-10-28 09:00、2026-10-28T09:00、2026年10月28日 9時30分 などを受け付ける（秒は無視）。
 */
export function parseCsvDateTime(value: string): string | null {
  const v = normalizeText(value);
  const m = v.match(/^(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})日?(?:\s*|T)(\d{1,2})[:時](\d{1,2})(?:分|:\d{1,2}(?:\.\d+)?)?$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

/** 数値の文字列（¥12,000・12000円・全角数字）を数にする。空なら null、読めなければ NaN */
export function parseCsvNumber(value: string): number | null {
  const v = normalizeText(value).replace(/[¥￥,円個\s]/g, "");
  if (v === "") return null;
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : Number.NaN;
}

export type ParsedImport = { fileErrors: string[]; warnings: string[]; rows: ImportRow[] };

/** 見出しと行から、取り込む値を読み取る（マスタとの照合・入力チェックはサーバーで行う） */
export function readImportRows(header: string[], rows: string[][]): ParsedImport {
  const fileErrors: string[] = [];
  const warnings: string[] = [];
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    if (h && !index.has(h)) index.set(h, i);
  });
  const columns = Object.fromEntries(
    (Object.keys(ALIASES) as Field[]).map((f) => [f, ALIASES[f].map((a) => index.get(a)).filter((i): i is number => i !== undefined)]),
  ) as Record<Field, number[]>;

  const missing = REQUIRED.filter((f) => columns[f].length === 0);
  if (missing.length > 0) {
    fileErrors.push(`必要な列がありません：${missing.map((f) => FIELD_LABEL[f]).join("、")}（ひな形の列名を使ってください）`);
  }
  if (rows.length === 0) fileErrors.push("取り込む行がありません");
  if (rows.length > ORDER_IMPORT_MAX_ROWS) fileErrors.push(`一度に取り込めるのは ${ORDER_IMPORT_MAX_ROWS} 行までです（${rows.length} 行あります）。ファイルを分けてください`);
  if (index.has("案件ID") || index.has("ステータス")) {
    warnings.push("「案件ID」「ステータス」などの列は使いません。すべて新しい案件（未割当または配車済）として登録します");
  }
  if (fileErrors.length > 0) return { fileErrors, warnings, rows: [] };

  const get = (row: string[], f: Field) => {
    for (const i of columns[f]) {
      const v = unescapeCell(normalizeText(row[i]));
      if (v !== "") return v;
    }
    return "";
  };
  return {
    fileErrors,
    warnings,
    rows: rows.map((row, i) => {
      const pickupRaw = get(row, "pickupAt");
      const deliveryRaw = get(row, "deliveryAt");
      const quantityRaw = get(row, "quantity");
      const feeRaw = get(row, "fee");
      return {
        line: i + 2,
        client: get(row, "client"),
        pickupAddress: get(row, "pickupAddress"),
        deliveryName: get(row, "deliveryName"),
        deliveryAddress: get(row, "deliveryAddress"),
        pickupAt: parseCsvDateTime(pickupRaw),
        deliveryAt: parseCsvDateTime(deliveryRaw),
        driver: get(row, "driver"),
        vehicle: get(row, "vehicle"),
        cargoType: get(row, "cargoType"),
        quantity: parseCsvNumber(quantityRaw),
        fee: parseCsvNumber(feeRaw),
        // 備考は改行を残す
        notes: columns.notes.map((c) => unescapeCell((row[c] ?? "").normalize("NFKC").trim())).find((v) => v !== "") ?? "",
        raw: { pickupAt: pickupRaw, deliveryAt: deliveryRaw, quantity: quantityRaw, fee: feeRaw },
      };
    }),
  };
}

/** マスタとの照合用のキー（全角半角・空白・大文字小文字の違いを無視） */
export function matchKey(value: string): string {
  return normalizeText(value).replace(/\s/g, "").toLowerCase();
}

/** 書き出す日時の形式（Excel でも日時として扱われる 2026/10/28 09:30、日本時間） */
export function formatCsvDateTime(at: Date | null): string {
  if (!at) return "";
  const d = new Date(at.getTime() + 9 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
