import { test, expect, expectNoHorizontalOverflow } from "./fixtures";

test.describe("スマートフォン表示", () => {
  test("管理者：メニューから各画面へ移動でき、横にはみ出さない @mobile", async ({ adminPage: page }) => {
    await expectNoHorizontalOverflow(page);
    // サイドバーは隠れ、メニューボタンから開く
    await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeHidden();
    for (const [label, path] of [["配送案件", "/orders"], ["配車管理", "/dispatch"], ["売上・分析", "/analytics"], ["設定", "/settings"]] as const) {
      await page.getByRole("button", { name: "メニューを開く" }).click();
      await page.getByRole("dialog").getByRole("link", { name: label }).click();
      await page.waitForURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    // 案件一覧は表ではなくカードで表示する
    await page.goto("/orders");
    await expect(page.locator("main table")).toBeHidden();
    await expect(page.locator('main a[href^="/orders/"]').filter({ visible: true }).first()).toBeVisible();
  });

  test("ドライバー：下部メニューで移動でき、横にはみ出さない @mobile", async ({ driverPage: page }) => {
    const nav = page.getByRole("navigation", { name: "ドライバーメニュー" });
    await expect(nav).toBeVisible();
    await expectNoHorizontalOverflow(page);
    for (const [label, path] of [["本日の配送", "/driver/orders"], ["配送履歴", "/driver/history"], ["ホーム", "/driver"]] as const) {
      await nav.getByRole("link", { name: label }).click();
      await page.waitForURL(new RegExp(`${path}$`));
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
      await expectNoHorizontalOverflow(page);
    }
    // 押しやすい大きさ（高さ 44px 以上）
    const box = await nav.getByRole("link", { name: "本日の配送" }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
