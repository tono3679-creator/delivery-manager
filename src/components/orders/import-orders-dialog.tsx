"use client";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, CircleCheck, FileSpreadsheet, FileUp, Loader2, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { commitOrderImport, previewOrderImport, type ImportPreview } from "@/lib/actions/csv";
import { ORDER_IMPORT_MAX_BYTES, ORDER_IMPORT_MAX_ROWS } from "@/lib/csv/limits";
import { formatDateShort, formatNumber, formatYen } from "@/lib/format";
import { cn } from "@/lib/utils";

const ENCODING_LABEL: Record<ImportPreview["encoding"], string> = { "utf-8": "UTF-8", shift_jis: "Shift_JIS", "utf-16le": "UTF-16" };

type Problem = { error: string; details?: string[] };

/** CSV 取り込みボタン＋ダイアログ（ファイルを選ぶ → 内容を確認 → 登録） */
export function ImportOrdersButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload aria-hidden />
        CSV 取り込み
      </Button>
      <ImportOrdersDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function ImportOrdersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [dragging, setDragging] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setProblem(null);
    setOnlyProblems(false);
    setAcknowledged(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const check = async (next: File) => {
    reset();
    setFile(next);
    if (next.size > ORDER_IMPORT_MAX_BYTES) {
      setProblem({ error: `ファイルが大きすぎます（${Math.round(ORDER_IMPORT_MAX_BYTES / 1024)}KB まで）。ファイルを分けてください` });
      return;
    }
    setBusy("preview");
    try {
      const fd = new FormData();
      fd.set("file", next);
      const result = await previewOrderImport(fd);
      if (result.ok) {
        setPreview(result.preview);
        setOnlyProblems(result.preview.errorCount > 0);
      } else setProblem(result);
    } catch {
      setProblem({ error: "通信できませんでした。接続を確認してから、もう一度お試しください" });
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!file || !preview) return;
    setBusy("commit");
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("digest", preview.digest);
      fd.set("warnings", String(preview.warningCount));
      const result = await commitOrderImport(fd);
      if (result.ok) {
        toast.success(`${formatNumber(result.count, "件")}の案件を登録しました（${result.firstNo}〜${result.lastNo}）`);
        onOpenChange(false);
        reset();
        router.refresh();
        return;
      }
      // 確認した後に状況が変わった場合は、新しい確認結果を出して見直してもらう
      if (result.preview) {
        setPreview(result.preview);
        setAcknowledged(false);
        setOnlyProblems(true);
      }
      setProblem(result);
    } catch {
      setProblem({ error: "通信できませんでした。登録されたかどうかを一覧で確認してください" });
    } finally {
      setBusy(null);
    }
  };

  const okCount = preview ? preview.rows.length - preview.errorCount : 0;
  const canCommit = Boolean(preview && preview.errorCount === 0 && okCount > 0 && (preview.warningCount === 0 || acknowledged));
  const rows = preview ? (onlyProblems ? preview.rows.filter((r) => r.errors.length > 0 || r.warnings.length > 0) : preview.rows) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy === "commit") return;
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>CSV から案件を取り込む</DialogTitle>
          <DialogDescription>
            CSV ファイルの案件を新しい案件としてまとめて登録します。登録する前に内容を確認できます。
          </DialogDescription>
        </DialogHeader>

        {!preview && (
          <div className="space-y-4">
            <label
              htmlFor={inputId}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files[0];
                if (dropped) void check(dropped);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
                "hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring",
                dragging && "border-brand bg-info-soft",
                busy && "pointer-events-none opacity-60",
              )}
            >
              {busy === "preview" ? <Loader2 className="size-8 animate-spin text-brand" aria-hidden /> : <FileUp className="size-8 text-brand" aria-hidden />}
              <span className="font-medium">{busy === "preview" ? `${file?.name ?? "ファイル"} を確認しています…` : "CSV ファイルを選ぶ"}</span>
              <span className="text-xs text-muted-foreground">またはここにドラッグ＆ドロップ</span>
              <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept=".csv,.tsv,.txt,text/csv"
                className="sr-only"
                disabled={busy !== null}
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  if (picked) void check(picked);
                }}
              />
            </label>

            {problem && <ProblemBox problem={problem} />}

            <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
              <a href="/api/orders/import-template" download className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
                <FileSpreadsheet className="size-4" aria-hidden />
                ひな形（記入例つき CSV）をダウンロード
              </a>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                <li>文字コードは UTF-8・Shift_JIS のどちらでも読み込めます（Excel で保存した CSV もそのまま使えます）。</li>
                <li>
                  必須の列：荷主（荷主コードまたは会社名）・配送先名・配送先住所・集荷予定日時・配送予定日時・荷物の種類・数量・配送料金。
                  集荷先住所が空欄なら荷主の住所を使います。
                </li>
                <li>担当ドライバーを入れると「配車済」、空欄なら「未割当」で登録します。車両が空欄ならドライバーの担当車両を使います。</li>
                <li>1回に {formatNumber(ORDER_IMPORT_MAX_ROWS, "行")}まで。この画面で書き出した CSV もそのまま取り込めます（新しい案件として登録します）。</li>
              </ul>
            </div>
          </div>
        )}

        {preview && (
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5">
                <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-medium">{preview.fileName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">（{ENCODING_LABEL[preview.encoding]}）</span>
              </span>
              <span>全 <strong className="tabular">{formatNumber(preview.rows.length)}</strong> 行</span>
              <span className="text-success-strong">登録できる <strong className="tabular">{formatNumber(okCount)}</strong> 行</span>
              {preview.errorCount > 0 && <span className="text-danger-strong">エラー <strong className="tabular">{formatNumber(preview.errorCount)}</strong> 行</span>}
              {preview.warningCount > 0 && <span className="text-warning-strong">注意 <strong className="tabular">{formatNumber(preview.warningCount)}</strong> 行</span>}
            </div>

            {problem && <ProblemBox problem={problem} />}
            {!problem && preview.errorCount > 0 && (
              <ProblemBox
                problem={{
                  error: "エラーのある行があるため、このままでは登録できません。",
                  details: ["CSV を直してから「別のファイルを選ぶ」でもう一度読み込んでください。一部の行だけが登録されることはありません。"],
                }}
              />
            )}
            {preview.fileWarnings.map((w) => (
              <p key={w} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning-strong" aria-hidden />
                {w}
              </p>
            ))}

            {(preview.errorCount > 0 || preview.warningCount > 0) && (
              <label className="flex w-fit items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                エラー・注意のある行だけ表示
              </label>
            )}

            <ol className="max-h-[45vh] divide-y overflow-y-auto rounded-lg border" aria-label="取り込む行の確認結果">
              {rows.map((r) => {
                const state = r.errors.length > 0 ? "error" : r.warnings.length > 0 ? "warning" : "ok";
                return (
                  <li key={r.line} className={cn("px-3 py-2 text-sm", state === "error" && "bg-danger-soft/60")}>
                    <div className="flex items-start gap-2">
                      <RowStateIcon state={state} />
                      <span className="w-12 shrink-0 text-xs text-muted-foreground tabular">{r.line}行目</span>
                      <div className="grid min-w-0 flex-1 gap-x-3 sm:grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1fr)_5.5rem]">
                        <span className="tabular">
                          {r.deliveryAt ? `${formatDateShort(r.deliveryAt.slice(0, 10))} ${r.deliveryAt.slice(11)}` : "日時なし"}
                        </span>
                        <span className="truncate" title={r.deliveryName}>{r.deliveryName || "（配送先名なし）"}</span>
                        <span className="truncate text-muted-foreground" title={`${r.clientName} / ${r.driverName ?? "未割当"}`}>
                          {r.clientName || "（荷主なし）"}・{r.driverName ?? "未割当"}
                        </span>
                        <span className="tabular sm:text-right">{formatYen(r.fee)}</span>
                      </div>
                    </div>
                    {(r.errors.length > 0 || r.warnings.length > 0) && (
                      <ul className="mt-1 space-y-0.5 pl-6 text-xs sm:pl-20">
                        {r.errors.map((m) => <li key={m} className="text-danger-strong"><span className="sr-only">エラー：</span>{m}</li>)}
                        {r.warnings.map((m) => <li key={m} className="text-warning-strong"><span className="sr-only">注意：</span>{m}</li>)}
                      </ul>
                    )}
                  </li>
                );
              })}
              {rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">表示する行はありません</li>}
            </ol>

            {preview.errorCount === 0 && preview.warningCount > 0 && (
              <label className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-[var(--warning)]"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>注意のある {formatNumber(preview.warningCount, "行")}の内容を確認しました。このまま登録します。</span>
              </label>
            )}
          </div>
        )}

        <DialogFooter>
          {preview ? (
            <>
              <Button variant="outline" onClick={reset} disabled={busy !== null}>別のファイルを選ぶ</Button>
              <Button onClick={commit} disabled={!canCommit || busy !== null}>
                {busy === "commit" && <Loader2 className="animate-spin" aria-hidden />}
                {formatNumber(okCount, "件")}を登録する
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>閉じる</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RowStateIcon({ state }: { state: "ok" | "warning" | "error" }) {
  if (state === "error") return <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="エラー" />;
  if (state === "warning") return <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-label="注意" />;
  return <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-label="登録できます" />;
}

function ProblemBox({ problem }: { problem: Problem }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger-strong">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">{problem.error}</p>
        {problem.details?.map((d) => <p key={d} className="text-xs">{d}</p>)}
      </div>
    </div>
  );
}
