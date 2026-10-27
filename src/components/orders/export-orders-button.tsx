"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

/**
 * 一覧の検索条件のまま CSV に書き出す。
 * 失敗したとき（件数の上限・ログイン切れなど）に画面で知らせるため、リンクではなく取得してから保存する。
 */
export function ExportOrdersButton({ href, total, limit }: { href: string; total: number; limit: number }) {
  const [busy, setBusy] = useState(false);
  const tooMany = total > limit;

  const run = async () => {
    if (total === 0) {
      toast.info("書き出す案件がありません。検索条件を変えてください");
      return;
    }
    if (tooMany) {
      toast.error(`書き出せるのは ${formatNumber(limit, "件")}までです（${formatNumber(total, "件")}あります）。期間などで絞り込んでください`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(href, { cache: "no-store" });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("text/csv")) {
        const message = type.includes("application/json") ? ((await res.json()) as { error?: string }).error : undefined;
        toast.error(message ?? "書き出せませんでした。ログインし直してから、もう一度お試しください");
        return;
      }
      const blob = await res.blob();
      const match = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match ? decodeURIComponent(match[1]) : "orders.csv";
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`${formatNumber(Number(res.headers.get("x-row-count") ?? total), "件")}を CSV に書き出しました`);
    } catch {
      toast.error("通信できませんでした。接続を確認してから、もう一度お試しください");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onClick={run} disabled={busy} aria-describedby="export-hint">
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
      CSV 書き出し
      <span id="export-hint" className="sr-only">
        いまの検索条件の {formatNumber(total, "件")}を書き出します
      </span>
    </Button>
  );
}
