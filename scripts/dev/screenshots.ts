/**
 * README 用のスクリーンショットを撮る（docs/images/*.png）。
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/dev/screenshots.ts
 *
 * 「体験」ボタンから新しいデモ環境を作って撮影する（既存のデータは変更しない）。
 * 日中（9〜18時）に撮ると、配送中の案件が地図と配車ボードに写る。
 * 地図タイルに接続できない環境では OFFLINE_TILES=1 を付けると、タイルを無地にする。
 */
import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "docs/images";
const BLANK_TILE = Buffer.from(
  // 1px の地図の地の色（OpenStreetMap の陸地に近い色）
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP49P4lAAWhAstl7N0JAAAAAElFTkSuQmCC",
  "base64",
);

async function newContext(browser: Awaited<ReturnType<typeof chromium.launch>>, mobile: boolean): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    colorScheme: "light",
  });
  if (process.env.OFFLINE_TILES === "1") {
    await context.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ body: BLANK_TILE, contentType: "image/png" }));
  }
  return context;
}

async function startDemo(page: Page, role: "admin" | "driver") {
  await page.goto("/login");
  await page.getByRole("button", { name: role === "admin" ? /管理者として体験/ : /ドライバーとして体験/ }).click();
  const ready = role === "admin" ? /\/dashboard$/ : /\/driver$/;
  // 作成に失敗したとき（デモ数の上限など）はエラーのトーストが出るので、その文言で失敗させる
  const failed = page.locator('[data-sonner-toast][data-type="error"]');
  const result = await Promise.race([
    page.waitForURL(ready, { timeout: 90_000 }).then(() => "ok", () => "timeout"),
    failed.waitFor({ timeout: 90_000 }).then(() => "error", () => "timeout"),
  ]);
  if (result === "error") throw new Error(`デモを開始できませんでした：${await failed.first().innerText()}`);
  if (!ready.test(page.url())) throw new Error(`デモを開始できませんでした（${page.url()}）`);
}

async function shot(page: Page, path: string, name: string, fullPage = false) {
  await page.goto(path, { waitUntil: "networkidle" });
  // 開発サーバーの表示（Next.js のインジケーター）を隠し、グラフのアニメーションを待つ
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`${OUT}/${name}.png`);
}

async function firstHref(page: Page, path: string, prefix: string): Promise<string> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  const href = await page.locator(`main a[href^="${prefix}"]`).first().getAttribute("href");
  if (!href) throw new Error(`${path} にリンクがありません`);
  return href;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  // 日付の入力欄などを日本語の表示にする
  const browser = await chromium.launch({ args: ["--lang=ja-JP"], env: { ...process.env, LANGUAGE: "ja" } });
  const jst = new Date(Date.now() + 9 * 3600_000);
  const day = jst.getUTCHours() >= 19 ? new Date(jst.getTime() + 86_400_000) : jst;
  const boardDay = day.toISOString().slice(0, 10);

  const desktop = await newContext(browser, false);
  const admin = await desktop.newPage();
  await startDemo(admin, "admin");
  await shot(admin, "/dashboard", "dashboard");
  await shot(admin, "/orders", "orders");
  await shot(admin, `/dispatch?date=${boardDay}`, "dispatch");
  // 地図は実際のタイルが表示できるときだけ撮る
  if (process.env.OFFLINE_TILES !== "1") await shot(admin, `/dispatch?date=${boardDay}&view=map`, "dispatch-map");
  await shot(admin, "/analytics?period=last_6_months", "analytics");
  await shot(admin, await firstHref(admin, "/clients", "/clients/"), "client");
  const today = jst.toISOString().slice(0, 10);
  const delivered = await firstHref(admin, `/orders?from=${today}&to=${today}&status=delivered`, "/orders/").catch(() => null);
  await shot(admin, delivered ?? (await firstHref(admin, "/orders", "/orders/")), "order");
  await shot(admin, "/settings", "settings");

  const mobile = await newContext(browser, true);
  const driver = await mobile.newPage();
  await startDemo(driver, "driver");
  await shot(driver, "/driver", "driver-home");
  await shot(driver, "/driver/orders", "driver-orders");
  await shot(driver, await firstHref(driver, "/driver/orders", "/driver/orders/"), "driver-order");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
