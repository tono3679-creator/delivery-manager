import { test, expect } from "./fixtures";

test.describe("地図", () => {
  test("地図を拡大した直後にほかの画面へ移っても、エラーにならない", async ({ adminPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".leaflet-marker-icon").first()).toBeAttached();
    // 表示したときの位置合わせ（ズームのアニメーション）が終わるのを待つ
    await page.waitForTimeout(1000);
    // 拡大のアニメーション（約250ms）が終わる前に、画面を切り替える
    await page.locator(".leaflet-control-zoom-in").click();
    await page.getByRole("link", { name: /配車管理で開く/ }).click();
    await page.waitForURL(/\/dispatch\?view=map$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("配車管理");
    // 古い地図の終了処理が動く時間を待つ（エラーが出ればテストの最後に失敗する）
    await page.waitForTimeout(600);
  });
});
