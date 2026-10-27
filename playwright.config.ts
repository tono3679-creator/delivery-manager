import { defineConfig, devices } from "@playwright/test";

/**
 * ブラウザでの E2E テスト（npm run test:e2e）。
 *
 * ローカル PostgreSQL（npm run db:local:reset && npm run db:seed 済み）と、ローカル認証サーバーを使う。
 * テストごとに「デモを体験」から専用のデモ会社を作るので、テスト同士・既存データと干渉しない。
 *
 *   npm run test:e2e                               … next dev で起動して実行
 *   E2E_COMMAND="npx next start -p 3100" npm run test:e2e   … ビルド済みのアプリで実行（CI）
 *   E2E_BASE_URL=https://… DATABASE_URL=… npx playwright test  … 公開環境に対して実行（アプリは起動しない。
 *                                                              DATABASE_URL はテストで作ったデモ会社の片付けに使う）
 */
const PORT = 3100;
const EXTERNAL_URL = process.env.E2E_BASE_URL?.replace(/\/$/, "");
const BASE_URL = EXTERNAL_URL || `http://localhost:${PORT}`;
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/dm";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 45_000,
    actionTimeout: 20_000,
    // 日本語のファイル名でダウンロードできるよう、ブラウザを UTF-8 のロケールで起動する（LANG 未設定の環境では "download" になる）
    launchOptions: { env: { ...process.env, LANG: process.env.LANG || "C.UTF-8" } },
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
      grepInvert: /@mobile/,
    },
    {
      name: "mobile",
      // スマートフォン（iPhone 相当の幅）。Chromium で幅とタッチを再現する
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
      grep: /@mobile|@both/,
    },
  ],
  webServer: EXTERNAL_URL ? undefined : [
    {
      command: "npx tsx scripts/dev/local-auth-server.ts",
      url: "http://localhost:54321/auth/v1/health",
      reuseExistingServer: !process.env.CI,
      env: { DATABASE_URL },
      stdout: "ignore",
    },
    {
      command: process.env.E2E_COMMAND ?? `npx next dev -p ${PORT}`,
      url: `${BASE_URL}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        DATABASE_URL,
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local",
        NEXT_PUBLIC_REALTIME_ENABLED: "false",
        // テストごとにデモ会社を作るため、上限に当たらないようにする
        DEMO_MAX_ACTIVE: "1000",
      },
    },
  ],
});
