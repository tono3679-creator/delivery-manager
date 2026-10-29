import { expect, test } from "./fixtures";

/**
 * 画面の自動更新（30秒ごとの再取得）。
 * 開いたまま席を離れても DB への問い合わせが続かないよう、10分操作がなければ止め、操作すると再開する。
 */
test("10分操作がなければ自動更新を止め、操作すると再開する", async ({ adminPage: page }) => {
  await page.clock.install();
  await page.goto("/dashboard");
  const status = page.locator("header [aria-live=polite]").filter({ hasText: "自動更新" });
  await expect(status).toContainText("自動更新（30秒ごと）");

  await page.clock.fastForward("11:00");
  await expect(status).toContainText("自動更新を停止中（操作すると再開）");

  await page.getByRole("heading", { level: 1 }).click();
  await expect(status).toContainText("自動更新（30秒ごと）");
});
