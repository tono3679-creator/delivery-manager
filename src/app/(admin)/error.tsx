"use client";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center">
      <TriangleAlert className="size-8 text-destructive" aria-hidden />
      <h2 className="text-lg font-semibold">画面を表示できませんでした</h2>
      <p className="text-keep text-sm text-muted-foreground">
        通信状態を確認して、もう一度お試しください。繰り返し発生する場合は管理者にお問い合わせください。
      </p>
      {error.digest && <p className="text-xs text-muted-foreground">エラーID：{error.digest}</p>}
      <Button onClick={reset}>再読み込み</Button>
    </div>
  );
}
