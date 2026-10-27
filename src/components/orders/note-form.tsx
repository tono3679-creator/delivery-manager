"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type NoteAction = (input: { orderId: string; body: string }) => Promise<{ ok: true } | { ok: false; error: string }>;

/** 案件メモの入力（管理者・ドライバー共通。保存処理は呼び出し側の Server Action） */
export function NoteForm({ orderId, action, placeholder = "例：守衛室で受付が必要" }: { orderId: string; action: NoteAction; placeholder?: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        setPending(true);
        const result = await action({ orderId, body });
        setPending(false);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setBody("");
        toast.success("メモを追加しました");
        router.refresh();
      }}
    >
      <Textarea
        aria-label="メモ"
        rows={2}
        maxLength={1000}
        value={body}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="outline" disabled={pending || !body.trim()}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          メモを追加
        </Button>
      </div>
    </form>
  );
}
