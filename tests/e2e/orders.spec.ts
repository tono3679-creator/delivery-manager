import { test, expect, createOrder, jstDate, openOrder, readTotal, runId } from "./fixtures";

test.describe("配送案件の登録・編集・削除", () => {
  test("必須項目が空のままでは登録できず、項目ごとに理由が表示される", async ({ adminPage: page }) => {
    await page.goto("/orders");
    await page.getByRole("button", { name: "新規登録" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "登録する" }).click();
    await expect(dialog.locator("#clientId")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.locator("#deliveryName")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.locator("#deliveryAddress")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByRole("alert").first()).toBeVisible();
    // 送信されていない（ダイアログが開いたまま・トーストなし）
    await expect(dialog).toBeVisible();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "を登録しました" })).toHaveCount(0);
  });

  test("登録した案件を編集・削除でき、一覧と詳細に反映される", async ({ adminPage: page }) => {
    const name = `E2E配送先 ${runId()}`;
    const { orderNo } = await createOrder(page, { deliveryName: name, day: jstDate(1), pickup: "09:00", delivery: "10:00", fee: 12000 });
    expect(orderNo).toMatch(/^DM-\d{6}$/);

    // 一覧で検索できる
    await page.goto(`/orders?q=${encodeURIComponent(name)}`);
    expect(await readTotal(page)).toBe(1);

    // 詳細：登録した内容と「未割当」
    await openOrder(page, orderNo);
    await expect(page.getByText(`→ ${name}`)).toBeVisible();
    await expect(page.locator('[data-slot="badge"]').first()).toHaveText("未割当");
    await expect(page.getByText(/12,000/).first()).toBeVisible();

    // 編集：料金を変える
    await page.getByRole("button", { name: "編集" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#fee").fill("13500");
    await dialog.getByRole("button", { name: "更新する" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: `${orderNo} を更新しました` })).toBeVisible();
    await expect(page.getByText(/13,500/).first()).toBeVisible();
    // 編集は操作履歴に残る
    await page.goto("/settings?log=orders#audit");
    await expect(page.locator("#audit").getByText(orderNo).first()).toBeVisible();

    // 削除すると一覧から消える
    await openOrder(page, orderNo);
    await page.getByRole("button", { name: "削除" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "削除する" }).click();
    await page.waitForURL(/\/orders$/);
    await page.goto(`/orders?q=${encodeURIComponent(name)}`);
    expect(await readTotal(page)).toBe(0);
  });
});
