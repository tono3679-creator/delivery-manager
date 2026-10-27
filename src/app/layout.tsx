import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Delivery Manager", template: "%s | Delivery Manager" },
  description: "小規模配送会社向けの統合業務管理システム。配送案件・配車・ドライバー・車両・売上分析をひとつの画面で。",
};

export const viewport: Viewport = {
  themeColor: "#1e2a4a",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // ページは毎回サーバーで描画する（ログイン状態で内容が変わり、CSP の nonce をスクリプトに付けるため）
  await connection();
  return (
    <html lang="ja">
      <body>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
