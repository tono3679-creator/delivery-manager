import { test, expect, createOrder, jstDate, kpiValue, openOrder, runId } from "./fixtures";

test.describe("ドライバーのステータス更新", () => {
  test("ドライバーが担当案件を配送完了にすると、管理者の画面と売上に反映される @both", async ({ adminPage: page }) => {
    await page.goto("/dashboard");
    const revenueBefore = await kpiValue(page, "今月の売上");
    const profitBefore = await kpiValue(page, "今月の粗利益");
    const deliveredBefore = await kpiValue(page, "配送完了");

    const fee = 7300;
    const name = `E2E完了 ${runId()}`;
    const { orderNo, driverName } = await createOrder(page, {
      deliveryName: name, day: jstDate(0), pickup: "23:00", delivery: "23:30", fee, driver: "any",
    });

    // 担当ドライバーの画面に切り替える（デモ機能）
    await openOrder(page, orderNo);
    await page.getByRole("button", { name: `${driverName}さんの画面で確認（デモ）` }).click();
    await page.waitForURL(/\/driver\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    const badge = page.locator('[data-slot="badge"]').first();
    await expect(badge).toHaveText("配車済");

    await page.getByRole("button", { name: "集荷完了", exact: true }).click();
    await expect(badge).toHaveText("集荷完了");
    await page.getByRole("button", { name: "配送開始", exact: true }).click();
    await expect(badge).toHaveText("配送中");
    await page.getByRole("button", { name: "配送完了", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "配送完了にする" }).click();
    await expect(badge).toHaveText("配送完了");
    // 完了した案件はそれ以上進められない
    await expect(page.getByRole("button", { name: /^(集荷完了|配送開始|配送完了|配送失敗)$/ })).toHaveCount(0);

    // 管理者に戻ると、本日の完了件数・今月の売上と粗利益が料金の分だけ増えている
    await page.getByRole("button", { name: "管理者画面に戻る" }).click();
    await page.waitForURL(/\/dashboard$/);
    expect(await kpiValue(page, "配送完了")).toBe(deliveredBefore + 1);
    expect(await kpiValue(page, "今月の売上")).toBe(revenueBefore + fee);
    expect(await kpiValue(page, "今月の粗利益")).toBe(profitBefore + fee);

    // 案件の詳細：ステータスと、誰が更新したかの履歴
    await openOrder(page, orderNo);
    await expect(page.locator('[data-slot="badge"]').first()).toHaveText("配送完了");
    await expect(page.getByText(driverName!).first()).toBeVisible();
  });
});
