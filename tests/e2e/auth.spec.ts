import { currentUserId, endDemoFromMenu, expect, startDemo, test } from "./fixtures";

/**
 * ログイン・ログアウト（アプリ内のログイン）。
 * 見本の会社のアカウントのパスワードは、ローカルでは README の既定値、公開環境では E2E_LOGIN_PASSWORD。
 */
const ADMIN_EMAIL = "admin@minato-express.example";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD || (process.env.E2E_BASE_URL ? null : "demo-admin-2026");

test.describe("ログイン", () => {
  test("@both 間違ったパスワードでは入れず、正しいパスワードで入れる。ログアウトするとその Cookie はもう使えない", async ({ page, context }) => {
    test.skip(!PASSWORD, "公開環境では E2E_LOGIN_PASSWORD があるときだけ確かめる");
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill(ADMIN_EMAIL);
    await page.getByLabel("パスワード").fill("wrong-password-123");
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toContainText("メールアドレスまたはパスワードが正しくありません");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("パスワード").fill(PASSWORD as string);
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await page.waitForURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Cookie は JavaScript から読めず（HttpOnly）、ほかのサイトからの送信では付かない（SameSite=Lax）
    const session = (await context.cookies()).find((c) => c.name === "dm_session");
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    expect(await page.evaluate(() => document.cookie)).not.toContain("dm_session");

    await page.getByRole("button", { name: "ユーザーメニュー" }).first().click();
    await page.getByRole("menuitem", { name: "ログアウト" }).click();
    await page.waitForURL(/\/login$/);

    // ログアウトした Cookie を戻しても、サーバー側でセッションを消しているので入れない
    await context.addCookies([session!]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("デモの終了", () => {
  test("@both 「デモを終了する」でデモのデータを削除してログインへ戻る", async ({ page, db }) => {
    await startDemo(page, "admin");
    const userId = db ? await currentUserId(db, page) : null;
    if (db) expect(userId, "デモの利用者のセッションがある").toBeTruthy();

    await endDemoFromMenu(page);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    if (db && userId) {
      const [row] = await db<{ companies: number; users: number }[]>`
        select (select count(*)::int from companies where demo_owner = ${userId}) companies,
               (select count(*)::int from auth.users where id = ${userId}) users`;
      expect(row).toEqual({ companies: 0, users: 0 });
    }
  });
});
