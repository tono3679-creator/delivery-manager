/**
 * CSV の読み書き（DB を使わない部分）：書き出しの書式・数式対策、文字コードの判定、日時・数値の読み取り、列名の対応づけ。
 */
import { describe, expect, it } from "vitest";
import { CsvDecodeError, csvCell, decodeCsvBytes, parseCsv, toCsv } from "@/lib/csv/csv";
import {
  formatCsvDateTime, ORDER_IMPORT_HEADER, ORDER_IMPORT_MAX_ROWS, parseCsvDateTime, parseCsvNumber, readImportRows,
} from "@/lib/csv/orders";

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));

describe("書き出し（Excel で開いても文字化け・数式の実行が起きない）", () => {
  it("先頭に BOM を付け、改行は CRLF", () => {
    const csv = toCsv(["案件ID", "配送先名"], [["DM-000001", "山田商店"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("案件ID,配送先名\r\nDM-000001,山田商店\r\n");
    // UTF-8 にすると EF BB BF で始まる
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("コンマ・引用符・改行を含む値は引用符で囲み、引用符は二重にする", () => {
    expect(csvCell('東京都港区1-2-3, "本社" 3F')).toBe('"東京都港区1-2-3, ""本社"" 3F"');
    expect(csvCell("1行目\n2行目")).toBe('"1行目\n2行目"');
    expect(csvCell(" 前後に空白 ")).toBe('" 前後に空白 "');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("= + - @ で始まる文字列は ' を付けて数式として実行されないようにする（数値はそのまま）", () => {
    expect(csvCell("=HYPERLINK(\"http://example.com\")")).toBe("\"'=HYPERLINK(\"\"http://example.com\"\")\"");
    expect(csvCell("+81-3-1234-5678")).toBe("'+81-3-1234-5678");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tTAB")).toBe("'\tTAB");
    expect(csvCell(-500)).toBe("-500");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("書き出した CSV を読み込むと元の値に戻る（数式対策の ' も外れる）", () => {
    const values = ["=1+1", "改行\nあり", 'a,"b"', "普通の値"];
    const csv = toCsv(["荷主", "配送先名", "配送先住所", "備考"], [values]);
    const { text } = decodeCsvBytes(new TextEncoder().encode(csv));
    const { header, rows } = parseCsv(text);
    expect(header).toEqual(["荷主", "配送先名", "配送先住所", "備考"]);
    expect(rows[0][0]).toBe("'=1+1");
    expect(rows[0].slice(1)).toEqual(values.slice(1));
  });

  it("日時は日本時間の 2026/10/28 09:30 形式", () => {
    expect(formatCsvDateTime(new Date("2026-10-28T00:30:00Z"))).toBe("2026/10/28 09:30");
    expect(formatCsvDateTime(new Date("2026-10-27T15:05:00Z"))).toBe("2026/10/28 00:05");
    expect(formatCsvDateTime(null)).toBe("");
  });
});

describe("文字コードの判定（日本語 CSV の文字化け対策）", () => {
  const expected = "荷主,配送先名,備考\r\nC-001,髙橋商店①,\"改行\r\nあり\"\r\n";

  it("BOM 付き UTF-8", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(expected)]);
    expect(decodeCsvBytes(bytes)).toEqual({ text: expected, encoding: "utf-8" });
  });

  it("BOM なし UTF-8", () => {
    expect(decodeCsvBytes(new TextEncoder().encode(expected))).toEqual({ text: expected, encoding: "utf-8" });
  });

  it("Shift_JIS（Excel の「CSV（コンマ区切り）」。髙・① などの Windows の文字も読める）", () => {
    const sjis = hex("89d78ee52c947a919790e696bc2c94f58d6c0d0a432d3030312ceee08bb48fa4935887402c2289fc8d730d0a82a082e8220d0a");
    const result = decodeCsvBytes(sjis);
    expect(result.encoding).toBe("shift_jis");
    expect(result.text).toBe(expected);
    const { header, rows } = parseCsv(result.text);
    expect(header).toEqual(["荷主", "配送先名", "備考"]);
    expect(rows).toEqual([["C-001", "髙橋商店①", "改行\r\nあり"]]);
  });

  it("UTF-16（Excel の「Unicode テキスト」。タブ区切りも自動で判定）", () => {
    const text = "荷主\t配送先名\r\nC-001\t山田商店\r\n";
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) {
      bytes[2 + i * 2] = text.charCodeAt(i) & 0xff;
      bytes[3 + i * 2] = text.charCodeAt(i) >> 8;
    }
    const result = decodeCsvBytes(bytes);
    expect(result.encoding).toBe("utf-16le");
    expect(parseCsv(result.text)).toEqual({ header: ["荷主", "配送先名"], rows: [["C-001", "山田商店"]] });
  });

  it("引用符の対応が取れていない CSV はエラーにする", () => {
    expect(() => parseCsv('荷主,備考\r\nC-001,"閉じていない\r\n')).toThrow(CsvDecodeError);
  });

  it("空行は無視し、見出しの全角・空白の揺れはそろえる", () => {
    const { header, rows } = parseCsv("﻿ 荷主 ,配送先名\r\n\r\nC-001,山田\r\n,\r\n");
    expect(header).toEqual(["荷主", "配送先名"]);
    expect(rows).toEqual([["C-001", "山田"]]);
  });
});

describe("値の読み取り", () => {
  it("日時：よく使われる書き方を受け付け、存在しない日時は読み取らない", () => {
    expect(parseCsvDateTime("2026/10/28 9:00")).toBe("2026-10-28T09:00");
    expect(parseCsvDateTime("2026-10-28 09:30:00")).toBe("2026-10-28T09:30");
    expect(parseCsvDateTime("2026-10-28T14:05")).toBe("2026-10-28T14:05");
    expect(parseCsvDateTime("2026年10月28日 9時30分")).toBe("2026-10-28T09:30");
    expect(parseCsvDateTime("２０２６／１０／２８　９：００")).toBe("2026-10-28T09:00");
    expect(parseCsvDateTime("2026/02/30 9:00")).toBeNull();
    expect(parseCsvDateTime("2026/10/28 24:00")).toBeNull();
    expect(parseCsvDateTime("2026/10/28")).toBeNull();
    expect(parseCsvDateTime("")).toBeNull();
  });

  it("数値：円記号・桁区切り・全角数字を受け付け、空は null、読めない値は NaN", () => {
    expect(parseCsvNumber("￥12,000")).toBe(12000);
    expect(parseCsvNumber("4500円")).toBe(4500);
    expect(parseCsvNumber("３")).toBe(3);
    expect(parseCsvNumber("3個")).toBe(3);
    expect(parseCsvNumber("")).toBeNull();
    expect(parseCsvNumber("abc")).toBeNaN();
    expect(parseCsvNumber("1.2.3")).toBeNaN();
  });
});

describe("列名の対応づけ", () => {
  const row = ["C-001", "", "山田商店", "東京都江東区豊洲3-2-20", "2026/10/28 9:00", "2026/10/28 10:30", "山田 太郎", "", "段ボール", "3", "4,500", "午前中"];

  it("ひな形の列を読み取る（行番号は見出しを1行目として数える）", () => {
    const r = readImportRows([...ORDER_IMPORT_HEADER], [row, row]);
    expect(r.fileErrors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      line: 2, client: "C-001", deliveryName: "山田商店", pickupAt: "2026-10-28T09:00", deliveryAt: "2026-10-28T10:30",
      driver: "山田 太郎", quantity: 3, fee: 4500, notes: "午前中",
    });
    expect(r.rows[1].line).toBe(3);
  });

  it("書き出した CSV の列名（荷主コード・使用車両など）でも読め、使わない列があることを知らせる", () => {
    const header = ["案件ID", "荷主コード", "荷主名", "集荷先住所", "配送先名", "配送先住所", "集荷予定日時", "配送予定日時", "担当ドライバー", "使用車両", "荷物の種類", "数量", "配送料金", "ステータス"];
    const r = readImportRows(header, [["DM-000001", "C-002", "別の名前", "", "配送先", "住所", "2026/10/28 9:00", "2026/10/28 10:00", "", "品川 400 あ 12-34", "書類", "1", "1000", "配送完了"]]);
    expect(r.fileErrors).toEqual([]);
    // 荷主はコードを優先する
    expect(r.rows[0].client).toBe("C-002");
    expect(r.rows[0].vehicle).toBe("品川 400 あ 12-34");
    expect(r.warnings.join()).toContain("案件ID");
  });

  it("必要な列が無い・行が無い・行が多すぎるときはファイル全体のエラー", () => {
    expect(readImportRows(["荷主", "配送先名"], [["C-001", "x"]]).fileErrors[0]).toMatch(/必要な列がありません：配送先住所、集荷予定日時/);
    expect(readImportRows([...ORDER_IMPORT_HEADER], []).fileErrors).toContain("取り込む行がありません");
    const many = Array.from({ length: ORDER_IMPORT_MAX_ROWS + 1 }, () => row);
    expect(readImportRows([...ORDER_IMPORT_HEADER], many).fileErrors[0]).toMatch(/500 行まで/);
  });

  it("全角英数字・全角スペースはそろえ、備考の改行は残す。数式対策の ' は外す", () => {
    const r = readImportRows([...ORDER_IMPORT_HEADER], [["Ｃ－００１", "", "山田　商店", "住所", "2026/10/28 9:00", "2026/10/28 10:00", "", "", "'=書類", "1", "1", "1行目\n2行目"]]);
    expect(r.rows[0].client).toBe("C-001");
    expect(r.rows[0].deliveryName).toBe("山田 商店");
    expect(r.rows[0].cargoType).toBe("=書類");
    expect(r.rows[0].notes).toBe("1行目\n2行目");
  });

  it("読み取れない日時・数値は元の文字を残して、あとで分かりやすいエラーにする", () => {
    const r = readImportRows([...ORDER_IMPORT_HEADER], [["C-001", "", "x", "y", "明日の朝", "2026/10/28 10:00", "", "", "z", "たくさん", "1", ""]]);
    expect(r.rows[0].pickupAt).toBeNull();
    expect(r.rows[0].raw.pickupAt).toBe("明日の朝");
    expect(r.rows[0].quantity).toBeNaN();
    expect(r.rows[0].raw.quantity).toBe("たくさん");
  });
});
