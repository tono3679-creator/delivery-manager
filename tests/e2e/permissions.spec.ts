import { test, expect } from "./fixtures";

const ADMIN_PATHS = ["/dashboard", "/orders", "/dispatch", "/drivers", "/analytics", "/settings"];
const ADMIN_APIS = ["/api/orders/export", "/api/orders/import-template"];

test.describe("権限の分離", () => {
  test("ログインしていないと、画面はログインへ移動し、API は 401 を返す @both", async ({ page }) => {
    for (const path of [...ADMIN_PATHS, "/driver", "/driver/orders"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login/);
    }
    for (const path of ADMIN_APIS) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(401);
    }
  });

  test("ドライバーは管理者の画面を開けず、管理者用の API は 403 を返す @both", async ({ driverPage: page }) => {
    for (const path of ADMIN_PATHS) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/driver$/);
    }
    await expect(page.getByRole("navigation", { name: "メインメニュー" })).toHaveCount(0);
    for (const path of ADMIN_APIS) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(403);
    }
  });

  test("ドライバーは自分の案件だけを開け、ほかのドライバーの案件は表示されない", async ({ adminPage: page }) => {
    // 管理者として、担当ドライバーの異なる 2 件の案件を探す
    await page.goto("/drivers");
    const driverIds = await page
      .locator('main a[href^="/drivers/"]')
      .evaluateAll((links) => [...new Set(links.map((a) => a.getAttribute("href")!.split("/")[2]))]);
    const orderOf = async (driverId: string) => {
      await page.goto(`/orders?driver=${driverId}`);
      const href = await page.locator('main a[href^="/orders/"]').filter({ visible: true }).first().getAttribute("href");
      return href!.split("/")[2];
    };
    const otherOrder = await orderOf(driverIds[0]);
    const ownOrder = await orderOf(driverIds[1]);

    // 2 人目のドライバーに切り替える
    await page.goto(`/orders/${ownOrder}`);
    await page.getByRole("button", { name: /さんの画面で確認（デモ）/ }).click();
    await page.waitForURL(new RegExp(`/driver/orders/${ownOrder}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // 1 人目のドライバーの案件は「見つかりません」
    await page.goto(`/driver/orders/${otherOrder}`);
    await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
  });
});
