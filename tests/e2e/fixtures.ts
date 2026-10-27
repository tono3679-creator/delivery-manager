import { test as base, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres, { type Sql } from "postgres";

/** 地図タイルの代わりに返す 1px の灰色 PNG（外部の地図サーバーに依存しない） */
const GRAY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+P9/PQAJYwPNk1ZJ3wAAAABJRU5ErkJggg==",
  "base64",
);

type Fixtures = {
  /** 管理者としてデモを開始したページ（テストごとに専用のデモ会社） */
  adminPage: Page;
  /** ドライバーとしてデモを開始したページ */
  driverPage: Page;
  /** 画面で起きた JavaScript のエラー。テストの最後に空であることを確認する */
  pageErrors: string[];
};

type WorkerFixtures = {
  /** テストで作ったデモ会社を片付けるための DB 接続（ワーカーごとに1本） */
  db: Sql;
};

export const test = base.extend<Fixtures, WorkerFixtures>({
  db: [
    async ({}, provide) => {
      const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/dm", {
        max: 1,
        prepare: false,
        onnotice: () => {},
      });
      await provide(sql);
      await sql.end();
    },
    { scope: "worker" },
  ],
  context: async ({ context }, provide) => {
    await context.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ body: GRAY_PNG, contentType: "image/png" }));
    await provide(context);
  },
  pageErrors: [
    async ({ page }, provide) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error" && !/tile\.openstreetmap|Failed to load resource/.test(m.text())) errors.push(m.text());
      });
      await provide(errors);
      expect(errors, "画面で JavaScript のエラーが発生しました").toEqual([]);
    },
    { auto: true },
  ],
  adminPage: async ({ page, db }, provide) => {
    await startDemo(page, "admin");
    await provide(page);
    await removeDemo(db, page.context());
  },
  driverPage: async ({ page, db }, provide) => {
    await startDemo(page, "driver");
    await provide(page);
    await removeDemo(db, page.context());
  },
});

/**
 * テストで作ったデモ会社と一時ユーザーを削除する（期限切れのデモの削除と同じ）。
 * テストで登録した案件が DB に残ると、デモデータの整合性チェック（npm run db:verify・DB テスト）の対象になるため。
 */
async function removeDemo(db: Sql, context: BrowserContext) {
  const userId = await currentUserId(context);
  if (!userId) return;
  await db`delete from companies where is_demo and demo_owner = ${userId}`;
  await db`delete from auth.users where id = ${userId} and is_anonymous`;
}

/** ログイン中のユーザー ID（Supabase の認証 Cookie のアクセストークンから読む） */
async function currentUserId(context: BrowserContext): Promise<string | null> {
  const chunks = (await context.cookies())
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (chunks.length === 0) return null;
  const raw = chunks.map((c) => c.value).join("");
  const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64url").toString("utf8") : decodeURIComponent(raw);
  const token = (JSON.parse(json) as { access_token?: string }).access_token;
  if (!token) return null;
  return (JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { sub?: string }).sub ?? null;
}

export { expect };

/** ログイン画面の「〜として体験」から、専用のデモ環境を作って入る */
export async function startDemo(page: Page, role: "admin" | "driver") {
  await page.goto("/login");
  await page.getByRole("button", { name: role === "admin" ? /管理者として体験/ : /ドライバーとして体験/ }).click();
  const ready = role === "admin" ? /\/dashboard$/ : /\/driver$/;
  // 作成に失敗したとき（デモ数の上限など）はエラーのトーストが出るので、その文言で失敗させる
  const failed = page.locator('[data-sonner-toast][data-type="error"]');
  const result = await Promise.race([
    page.waitForURL(ready, { timeout: 60_000 }).then(() => "ok", () => "timeout"),
    failed.waitFor({ timeout: 60_000 }).then(() => "error", () => "timeout"),
  ]);
  if (result === "error") throw new Error(`デモを開始できませんでした：${await failed.first().innerText()}`);
  if (!ready.test(page.url())) throw new Error(`デモを開始できませんでした（${page.url()}）`);
}

/** 日本時間の日付（YYYY-MM-DD）。days で前後にずらす */
export function jstDate(days = 0): string {
  return new Date(Date.now() + 9 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

/** テストで作るデータを見分けるための短い ID */
export function runId(): string {
  return `${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
}

/** 最後に表示されたトーストの文言 */
export function lastToast(page: Page): Locator {
  return page.locator("[data-sonner-toast]").last();
}

/** 一覧の「該当 N 件」を数値で読む */
export async function readTotal(page: Page): Promise<number> {
  const text = await page.getByText(/^該当\s*[\d,]+\s*件$/).first().innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

/** ラジオ風の Select（Radix）で選択肢を選ぶ。name を省略すると選べる最初の選択肢を選び、その表示名を返す */
export async function choose(page: Page, trigger: Locator, name?: string | RegExp): Promise<string> {
  await trigger.click();
  const options = page.getByRole("option");
  const option = name
    ? options.filter({ hasText: name }).first()
    : options.filter({ hasNotText: /未割当|指定なし/ }).and(page.locator(":not([data-disabled])")).first();
  const label = (await option.innerText()).trim();
  await option.click();
  return label;
}

export type NewOrder = {
  deliveryName: string;
  deliveryAddress?: string;
  day: string;
  pickup: string;
  delivery: string;
  fee: number;
  driver?: string | RegExp | "any";
};

/**
 * 配送案件一覧の「新規登録」から案件を登録し、案件番号を返す（ページは一覧のまま）。
 * 担当ドライバーの予定と重なった場合は「重複を承知で保存」する。
 */
export async function createOrder(page: Page, o: NewOrder): Promise<{ orderNo: string; driverName: string | null }> {
  await page.goto("/orders");
  await page.getByRole("button", { name: "新規登録" }).click();
  const dialog = page.getByRole("dialog");
  await choose(page, dialog.locator("#clientId"));
  await dialog.locator("#deliveryName").fill(o.deliveryName);
  await dialog.locator("#deliveryAddress").fill(o.deliveryAddress ?? "東京都港区芝浦3-4-1");
  await dialog.locator("#pickupAt").fill(`${o.day}T${o.pickup}`);
  await dialog.locator("#deliveryAt").fill(`${o.day}T${o.delivery}`);
  await dialog.locator("#cargoType").fill("精密機器");
  await dialog.locator("#fee").fill(String(o.fee));
  let driverName: string | null = null;
  if (o.driver) {
    const label = await choose(page, dialog.locator("#driverId"), o.driver === "any" ? undefined : o.driver);
    driverName = label.replace(/（.*$/, "").trim();
  }
  await dialog.getByRole("button", { name: "登録する" }).click();
  const overlap = page.getByRole("alertdialog").filter({ hasText: "配送予定が重複しています" });
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: /を登録しました/ });
  await expect(overlap.or(toast)).toBeVisible();
  if (await overlap.isVisible()) await overlap.getByRole("button", { name: "重複を承知で保存" }).click();
  await expect(toast).toBeVisible();
  const orderNo = (await toast.innerText()).match(/([A-Z0-9-]+) を登録しました/)?.[1];
  expect(orderNo, "トーストに案件番号が表示される").toBeTruthy();
  await expect(dialog).toBeHidden();
  return { orderNo: orderNo!, driverName };
}

/** 一覧で案件番号を検索して詳細を開く */
export async function openOrder(page: Page, orderNo: string) {
  await page.goto(`/orders?q=${encodeURIComponent(orderNo)}`);
  await page.locator(`a[href^="/orders/"]`, { hasText: orderNo }).filter({ visible: true }).first().click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(orderNo);
}

/** KPI カードの値（数字以外を除いた数値） */
export async function kpiValue(page: Page, label: string): Promise<number> {
  const card = page.locator('[data-slot="card"]', { has: page.getByText(label, { exact: true }) }).first();
  const text = await card.locator("span.tabular").first().innerText();
  return Number(text.replace(/[^\d-]/g, ""));
}

/** 横スクロールが出ていない（表など、横スクロールを意図した領域は除く） */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "ページが横にはみ出していない").toBeLessThanOrEqual(0);
}
