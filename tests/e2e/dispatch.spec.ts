import { test, expect, choose, createOrder, jstDate, openOrder, runId } from "./fixtures";

test.describe("配車", () => {
  test("配車ボードで未割当の案件をドライバーに割り当てられる", async ({ adminPage: page }) => {
    const day = jstDate(1);
    const name = `E2E配車 ${runId()}`;
    const { orderNo } = await createOrder(page, { deliveryName: name, day, pickup: "06:00", delivery: "06:30", fee: 8000 });

    await page.goto(`/dispatch?date=${day}`);
    const board = page.getByRole("region", { name: /配車ボード/ });
    await board.getByRole("button", { name: new RegExp(`^${orderNo} .*未割当`) }).click();

    // 詳細パネル（ドラッグできない環境でも使える経路）で担当を選んで保存
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText(orderNo);
    const driver = (await choose(page, sheet.locator("#sheet-driver"))).replace(/（.*$/, "");
    await sheet.getByRole("button", { name: "保存する" }).click();
    const overlap = page.getByRole("alertdialog");
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: `${orderNo} を ${driver}さんに配車しました` });
    await expect(overlap.or(toast)).toBeVisible();
    if (await overlap.isVisible()) await overlap.getByRole("button", { name: "重複を承知で配車" }).click();
    await expect(toast).toBeVisible();

    // 再読み込みしても、そのドライバーの行に「配車済」で表示される
    await page.reload();
    const row = board.locator("div.grid", { has: page.locator("div.sticky.left-0", { hasText: driver }) });
    await expect(row.getByRole("button", { name: new RegExp(`^${orderNo} .*配車済`) })).toBeVisible();

    // 案件の詳細にも担当が表示される
    await openOrder(page, orderNo);
    await expect(page.locator('[data-slot="badge"]').first()).toHaveText("配車済");
    await expect(page.getByRole("button", { name: `${driver}さんの画面で確認（デモ）` })).toBeVisible();
  });
});
