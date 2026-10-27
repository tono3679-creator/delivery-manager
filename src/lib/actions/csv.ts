"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { asAdmin } from "@/lib/auth";
import { CsvDecodeError, decodeCsvBytes, parseCsv, type CsvEncoding } from "@/lib/csv/csv";
import { ORDER_IMPORT_MAX_BYTES, readImportRows, type ImportRow } from "@/lib/csv/orders";
import { insertImportedOrders, validateImportRows, type ImportPreviewRow, type ValidatedImport } from "@/lib/data/order-import";
import { toUserMessage } from "./errors";

/** 取り込み前の確認画面に出す内容 */
export type ImportPreview = {
  fileName: string;
  /** 確認したファイルと登録するファイルが同じかを確かめるための値 */
  digest: string;
  encoding: CsvEncoding;
  rows: ImportPreviewRow[];
  errorCount: number;
  warningCount: number;
  /** ファイル全体についての注意（使わない列がある、など） */
  fileWarnings: string[];
};

export type PreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: string; details?: string[] };
export type CommitResult =
  | { ok: true; count: number; firstNo: string; lastNo: string }
  | { ok: false; error: string; details?: string[]; preview?: ImportPreview };

type Upload = { fileName: string; digest: string; encoding: CsvEncoding; rows: ImportRow[]; fileWarnings: string[] };

/** 送られたファイルを確認して行を読み取る（文字コードの判定・必要な列・行数の上限） */
async function readUpload(formData: FormData): Promise<Upload | { error: string; details?: string[] }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "ファイルを選んでください（中身が空のファイルは取り込めません）" };
  const fileName = file.name.slice(0, 200);
  if (/\.(xlsx|xlsm|xls|numbers|ods)$/i.test(fileName)) {
    return { error: "表計算ソフトのファイルはそのまま取り込めません。「名前を付けて保存」で CSV 形式を選んで保存してください" };
  }
  if (file.size > ORDER_IMPORT_MAX_BYTES) {
    return { error: `ファイルが大きすぎます（${Math.round(ORDER_IMPORT_MAX_BYTES / 1024)}KB まで）。ファイルを分けてください` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const { text, encoding } = decodeCsvBytes(bytes);
    const { header, rows } = parseCsv(text);
    const parsed = readImportRows(header, rows);
    if (parsed.fileErrors.length > 0) return { error: parsed.fileErrors[0], details: parsed.fileErrors.slice(1) };
    return {
      fileName,
      digest: createHash("sha256").update(bytes).digest("hex"),
      encoding,
      rows: parsed.rows,
      fileWarnings: parsed.warnings,
    };
  } catch (e) {
    if (e instanceof CsvDecodeError) return { error: e.message };
    throw e;
  }
}

function toPreview(upload: Upload, validated: ValidatedImport): ImportPreview {
  return {
    fileName: upload.fileName,
    digest: upload.digest,
    encoding: upload.encoding,
    rows: validated.rows,
    errorCount: validated.errorCount,
    warningCount: validated.warningCount,
    fileWarnings: upload.fileWarnings,
  };
}

/**
 * CSV の内容を確認する（まだ登録しない）。
 * 荷主・ドライバー・車両は自社のマスタだけと照合する（RLS により他社のデータは見えない）。
 */
export async function previewOrderImport(formData: FormData): Promise<PreviewResult> {
  try {
    // 管理者であることを先に確かめてからファイルを読む
    return await asAdmin(async (tx) => {
      const upload = await readUpload(formData);
      if ("error" in upload) return { ok: false as const, error: upload.error, details: upload.details };
      const validated = await validateImportRows(tx, upload.rows);
      return { ok: true as const, preview: toPreview(upload, validated) };
    });
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "ファイルを確認できませんでした。時間をおいて再度お試しください") };
  }
}

/**
 * 確認した CSV を登録する。登録の直前にもう一度すべて検証し、1件でもエラーがあれば何も登録しない（全件か0件か）。
 * 確認したときより注意が増えている（その間に他の操作で予定が変わった）場合も、確認し直してもらう。
 */
export async function commitOrderImport(formData: FormData): Promise<CommitResult> {
  const digest = String(formData.get("digest") ?? "");
  const acknowledged = Number(formData.get("warnings") ?? 0);
  try {
    const result = await asAdmin(async (tx, user) => {
      const upload = await readUpload(formData);
      if ("error" in upload) return { ok: false as const, error: upload.error, details: upload.details };
      if (upload.digest !== digest) {
        return { ok: false as const, error: "確認したファイルと内容が違います。もう一度ファイルを選んで確認してください" };
      }
      // 同じ会社の取り込みは1つずつ行う（二重送信で同じ案件が2回登録されないように、後の方は重複の注意で止まる）
      await tx`select pg_advisory_xact_lock(hashtext('order-import:' || ${user.companyId}))`;
      const validated = await validateImportRows(tx, upload.rows);
      const preview = toPreview(upload, validated);
      if (validated.errorCount > 0 || validated.values.length !== upload.rows.length) {
        return { ok: false as const, error: `${Math.max(validated.errorCount, 1)}行にエラーがあるため登録しませんでした。内容を直してから取り込んでください`, preview };
      }
      if (validated.warningCount > (Number.isFinite(acknowledged) ? acknowledged : 0)) {
        return { ok: false as const, error: "確認した後に、登録済みの案件との重なりなどが増えました。内容を確認してからもう一度登録してください", preview };
      }
      const inserted = await insertImportedOrders(tx, user.companyId, validated.values);
      await tx`insert into audit_logs (company_id, actor_id, actor_name, action, entity, entity_id, detail)
               values (${user.companyId}, ${user.userId}, ${user.displayName}, 'import', 'delivery_order', null,
                       ${tx.json({
                         fileName: upload.fileName,
                         encoding: upload.encoding,
                         count: inserted.length,
                         warnings: validated.warningCount,
                         orderNos: inserted.map((r) => r.order_no),
                       })})`;
      return { ok: true as const, count: inserted.length, firstNo: inserted[0].order_no, lastNo: inserted[inserted.length - 1].order_no };
    });
    if (result.ok) {
      revalidatePath("/orders");
      revalidatePath("/dashboard");
      revalidatePath("/dispatch");
      revalidatePath("/driver", "layout");
    }
    return result;
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "登録できませんでした（1件も登録していません）。時間をおいて再度お試しください") };
  }
}
