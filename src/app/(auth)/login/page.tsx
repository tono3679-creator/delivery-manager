import { redirect } from "next/navigation";
import { CalendarClock, ChartColumn, ShieldCheck, Smartphone } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { getCurrentUser } from "@/lib/auth";
import { LoginPanel } from "./login-panel";

export const metadata = { title: "ログイン" };

const FEATURES = [
  { icon: CalendarClock, title: "ドラッグで配車", text: "時間×ドライバーのボードで割り当て。予定の重複は自動で警告します。" },
  { icon: Smartphone, title: "ドライバーはスマホで完結", text: "集荷・配送開始・完了をワンタップ。管理者の画面にすぐ反映されます。" },
  { icon: ChartColumn, title: "売上と利益が毎日わかる", text: "配送実績と経費から粗利益を自動で集計。荷主別・ドライバー別にも。" },
  { icon: ShieldCheck, title: "権限を DB で守る", text: "ドライバーは自分の案件だけ。会社ごとにデータを分離しています。" },
];

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "admin" ? "/dashboard" : "/driver");

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar px-12 py-12 text-sidebar-foreground lg:flex lg:flex-col">
        <Logo inverted />
        <div className="my-auto max-w-lg">
          <p className="text-sm font-medium text-brand">小規模配送会社向け 統合業務管理システム</p>
          <h1 className="text-keep mt-3 text-4xl leading-tight font-bold text-white">
            配送業務のすべてを、
            <br />
            ひとつの画面で。
          </h1>
          <p className="text-keep mt-4 text-base text-sidebar-muted">
            Excel・紙・ホワイトボードで管理していた案件・配車・車両・売上を一元化。
            従業員5〜30名の配送会社が、明日から使える業務システムです。
          </p>
          <ul className="mt-10 grid gap-5">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3.5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent">
                  <f.icon className="size-5 text-white" aria-hidden />
                </div>
                <div>
                  <div className="font-semibold text-white">{f.title}</div>
                  <div className="text-keep text-sm text-sidebar-muted">{f.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-sidebar-muted">表示されるデータはすべて架空のデモデータです。</p>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Logo className="mb-8 lg:hidden" />
          <LoginPanel />
        </div>
      </section>
    </div>
  );
}
