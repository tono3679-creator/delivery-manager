# Delivery Manager

**配送業務のすべてを、ひとつの画面で。**

従業員5〜30名の配送会社向けの統合業務管理システムです。配送案件・配車・ドライバー・車両・荷主・売上分析を一元管理し、ドライバーはスマートフォンから配送ステータスを更新できます。

> 営業用ポートフォリオとして開発中です。設計資料：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## 開発状況

| フェーズ | 内容 | 状態 |
| --- | --- | --- |
| Phase 1 基盤 | レイアウト・DB設計（RLS）・デモデータ・ログイン/デモ体験 | ✅ |
| Phase 2 コア | ダッシュボード・配送案件・配車ボード・ドライバー画面・連携 | ✅ |
| Phase 3 管理 | ドライバー・車両・荷主・売上/利益分析 | ⏳ |
| Phase 4 付加価値 | 地図・通知・CSV入出力 | ⏳ |
| Phase 5 仕上げ | レスポンシブ・性能・E2E・デプロイ | ⏳ |

## 技術スタック

Next.js 16（App Router）/ React 19 / TypeScript / Tailwind CSS 4 / shadcn/ui / Supabase（PostgreSQL・Auth・Realtime）/ postgres.js / Recharts / Leaflet / React Hook Form + Zod / Vitest / Playwright

## ローカルで動かす（Supabase なし）

PostgreSQL 16 と Node.js 22 があれば動きます。認証は Supabase Auth の代わりに同梱の簡易認証サーバーを使います。

```bash
npm install
cp .env.example .env.local      # 「ローカル開発」の行を有効にする
npm run db:local:reset          # DB作成 → Supabase互換のロール等 → マイグレーション
npm run db:seed                 # デモデータ（Seed値で再現可能）
npm run db:verify               # データ整合性チェック
npm run dev:auth &              # 簡易認証サーバー（:54321）
npm run dev                     # http://localhost:3000
```

ログイン画面の「管理者として体験」「ドライバーとして体験」から操作できます。Seed で作るアカウント：`admin@minato-express.example` / `demo-admin-2026`、`driver@minato-express.example` / `demo-driver-2026`。

## Supabase で動かす

1. Supabase のプロジェクトを作成し、Authentication → Sign In / Providers で **Anonymous sign-ins** を有効にする
2. `supabase link` → `supabase db push` でマイグレーションを適用
3. `.env.local` に URL・公開キー・`DATABASE_URL`（接続プーラー）を設定
4. `npm run db:seed`

## テスト

```bash
npm test           # 単体テスト＋DBテスト（権限分離・ステータス遷移・集計の一致・データ整合性）
npm run typecheck
npm run lint
```

## デモ環境の仕組み

- 「体験」ボタンを押すと匿名ログインし、**訪問者ごとに専用の配送会社**（案件 約6,000件）をその場で生成します。他の閲覧者の操作は見えません
- データは「今」を基準に作るので、いつ開いても稼働中の配送会社に見えます
- 24時間後に自動削除（Vercel Cron → `/api/cron/demo-cleanup`）
- デモ会社でのみ、管理者⇔ドライバーの画面を切り替えられます（切り替え後は DB の権限もドライバーになります）
