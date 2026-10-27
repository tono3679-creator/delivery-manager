import { test, expect } from "./fixtures";

// ブラウザの位置情報（東京駅付近）。テストでは許可済みにしておく
test.use({
  geolocation: { latitude: 35.6812, longitude: 139.7671, accuracy: 15 },
  permissions: ["geolocation"],
});

test.describe("ドライバーの現在地", () => {
  test("ドライバーが位置情報の共有をオンにすると、管理者の地図に GPS の現在地が出て、停止すると消える @both", async ({ adminPage: page }) => {
    // ドライバーの画面で共有を開始する
    await page.getByRole("button", { name: "ドライバー画面を体験" }).click();
    await page.waitForURL(/\/driver$/);
    const card = page.locator("#location-sharing");
    await expect(card.getByText("オフ", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "共有を開始" }).click();
    await expect(card.getByText(/^共有中・最終送信 \d{2}:\d{2}（精度 約15m）$/)).toBeVisible();
    await expect(page.getByRole("link", { name: "位置を共有中" })).toBeVisible();

    // 開き直しても共有中のまま（止めるまで続く）
    await page.reload();
    await expect(page.getByRole("link", { name: "位置を共有中" })).toBeVisible();
    await expect(card.getByRole("button", { name: "共有を停止" })).toBeVisible();

    // 管理者の地図（配車管理・地図）に、GPS の現在地として出る
    await page.getByRole("button", { name: "管理者画面に戻る" }).click();
    await page.waitForURL(/\/dashboard$/);
    await expect(page.locator('.dm-map-driver[title*="GPS"]')).toHaveCount(1);
    await page.goto("/dispatch?view=map");
    const marker = page.locator('.dm-map-driver[title*="GPS"]');
    await expect(marker).toHaveCount(1);
    const driverName = (await marker.getAttribute("title"))!.replace(/（.*$/, "");
    expect(driverName.length).toBeGreaterThan(0);

    await marker.click();
    const popup = page.locator(".leaflet-popup");
    await expect(popup).toContainText(driverName);
    await expect(popup).toContainText("GPS");
    await expect(popup).toContainText(/最終更新 \d{2}:\d{2}（1分以内）・精度 約15m/);

    // 一覧の「ドライバー」タブにも出る
    await page.getByRole("tab", { name: /^ドライバー/ }).click();
    const item = page.getByRole("list", { name: "ドライバーの現在地" }).getByRole("button", { name: new RegExp(driverName) });
    await expect(item).toContainText(/GPS \d{2}:\d{2}/);

    // 操作履歴に共有の開始が残る
    await page.goto("/settings?log=masters");
    await expect(page.getByText("位置情報の共有を開始").filter({ visible: true }).first()).toBeVisible();

    // ドライバーが停止すると、地図から消える
    await page.getByRole("button", { name: "ドライバー画面を体験" }).click();
    await page.waitForURL(/\/driver$/);
    await page.locator("#location-sharing").getByRole("button", { name: "共有を停止" }).click();
    await expect(page.locator("#location-sharing").getByText("オフ", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "位置を共有中" })).toHaveCount(0);
    await page.getByRole("button", { name: "管理者画面に戻る" }).click();
    await page.waitForURL(/\/dashboard$/);
    await page.goto("/dispatch?view=map");
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await expect(page.locator('.dm-map-driver[title*="GPS"]')).toHaveCount(0);
  });

  test("位置情報が許可されていないときは、理由を表示して共有しない", async ({ adminPage: page }) => {
    await page.context().clearPermissions();
    await page.getByRole("button", { name: "ドライバー画面を体験" }).click();
    await page.waitForURL(/\/driver$/);
    const card = page.locator("#location-sharing");
    await card.getByRole("button", { name: "共有を開始" }).click();
    await expect(card.getByRole("alert")).toContainText("位置情報の利用が許可されていません");
    await expect(card.getByRole("button", { name: "もう一度試す" })).toBeVisible();
    await expect(page.getByRole("link", { name: "位置を共有中" })).toHaveCount(0);
  });
});
