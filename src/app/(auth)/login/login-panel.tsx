"use client";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowRight, LayoutDashboard, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { signInWithPassword, startDemo } from "@/lib/actions/session";
import { cn } from "@/lib/utils";
import { safeAction } from "@/lib/client/safe-action";

const schema = z.object({
  email: z.email("メールアドレスの形式が正しくありません"),
  password: z.string().min(1, "パスワードを入力してください"),
});

export function LoginPanel() {
  const [pendingRole, setPendingRole] = useState<"admin" | "driver" | null>(null);
  const [, startTransition] = useTransition();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  const demo = (role: "admin" | "driver") => {
    setPendingRole(role);
    startTransition(async () => {
      const result = await safeAction(() => startDemo(role));
      // 成功時はサーバー側でリダイレクトされる
      if (result && !result.ok) {
        toast.error(result.error);
        setPendingRole(null);
      }
    });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await safeAction(() => signInWithPassword(values));
    if (result && !result.ok) toast.error(result.error);
  });

  const busy = pendingRole !== null || form.formState.isSubmitting;

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">デモを体験する</h2>
      <p className="text-keep mt-1.5 text-sm text-muted-foreground">
        登録は不要です。あなた専用のデモ環境（架空の配送会社）がすぐに作られます。
      </p>

      <div className="mt-6 grid gap-3">
        {([
          { role: "admin", icon: LayoutDashboard, title: "管理者として体験", text: "経営者・配車担当の画面（PC推奨）" },
          { role: "driver", icon: Smartphone, title: "ドライバーとして体験", text: "配送ドライバーのスマホ画面" },
        ] as const).map((item) => (
          <button
            key={item.role}
            type="button"
            onClick={() => demo(item.role)}
            disabled={busy}
            className={cn(
              "group flex items-center gap-4 rounded-xl border bg-card p-4 text-left shadow-xs transition-[border-color,box-shadow] hover:border-brand/60 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60",
              item.role === "admin" && "border-brand/40",
            )}
          >
            <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg", item.role === "admin" ? "bg-brand text-white" : "bg-primary text-primary-foreground")}>
              <item.icon className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{item.title}</div>
              <div className="text-sm text-muted-foreground">{item.text}</div>
            </div>
            {pendingRole === item.role ? (
              <Loader2 className="size-5 animate-spin text-brand" aria-label="準備中" />
            ) : (
              <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            )}
          </button>
        ))}
      </div>
      {pendingRole && (
        <p className="mt-3 text-center text-sm text-muted-foreground" aria-live="polite">
          デモ用の配送会社（案件 約6,000件）を準備しています…
        </p>
      )}

      <div className="my-8 flex items-center gap-3 text-xs text-muted-foreground">
        <Separator className="flex-1" />
        アカウントをお持ちの方
        <Separator className="flex-1" />
      </div>

      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor="email">メールアドレス</Label>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
          {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">パスワード</Label>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!form.formState.errors.password} {...form.register("password")} />
          {form.formState.errors.password && <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>}
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          {form.formState.isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
          ログイン
        </Button>
      </form>
    </div>
  );
}
