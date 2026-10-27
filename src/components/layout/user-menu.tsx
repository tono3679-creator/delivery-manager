"use client";
import { useTransition } from "react";
import { LogOut, Smartphone, LayoutDashboard, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resetDemo, signOut, switchDemoRole } from "@/lib/actions/session";

export function UserMenu({
  displayName, roleLabel, isDemo, role,
}: { displayName: string; roleLabel: string; isDemo: boolean; role: "admin" | "driver" }) {
  const [pending, startTransition] = useTransition();
  const initial = displayName.replace(/^(配車担当|事務|代表|デモ)\s*/, "").slice(0, 1);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-1.5 sm:px-2" aria-label="ユーザーメニュー">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {initial || "ユ"}
          </span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-sm font-medium">{displayName}</span>
            <span className="block text-[11px] text-muted-foreground">{roleLabel}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <div>{displayName}</div>
          <div className="text-xs font-normal text-muted-foreground">{roleLabel}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isDemo && (
          <>
            <DropdownMenuItem
              disabled={pending}
              onSelect={() => startTransition(() => switchDemoRole(role === "admin" ? "driver" : "admin"))}
            >
              {role === "admin" ? <Smartphone /> : <LayoutDashboard />}
              {role === "admin" ? "ドライバー画面に切り替え" : "管理者画面に切り替え"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={pending}
              onSelect={() =>
                startTransition(async () => {
                  const id = toast.loading("デモデータを初期化しています…");
                  await resetDemo();
                  toast.success("デモデータを初期状態に戻しました", { id });
                })
              }
            >
              <RotateCcw />
              デモデータを初期化
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={pending} onSelect={() => startTransition(() => signOut())}>
          <LogOut />
          ログアウト
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
