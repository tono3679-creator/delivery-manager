import { readFile } from "node:fs/promises";
import type { Download } from "@playwright/test";
import { test, expect, jstDate, readTotal, runId } from "./fixtures";

const lines = async (download: Download) => {
  const text = await readFile((await download.path())!, "utf8");
  expect(text.charCodeAt(0), "Excel で開けるよう BOM 付き UTF-8").toBe(0xfeff);
  return text.slice(1).trimEnd().split("\r\n");
};

test.describe("CSV 入出力", () => {
  test("一覧と同じ条件で書き出され、件数が一致する", async ({ adminPage: page }) => {
    const today = jstDate(0);
    // 直近1週間（休日は案件が少ないため1日だけにしない）
    await page.goto(`/orders?from=${jstDate(-7)}&to=${today}`);
    const total = await readTotal(page);
    expect(total).toBeGreaterThan(0);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /CSV 書き出し/ }).click()]);
    expect(download.suggestedFilename()).toBe(`配送案件_${today.replaceAll("-", "")}.csv`);
    const rows = await lines(download);
    expect(rows[0].split(",").slice(0, 3)).toEqual(["案件ID", "荷主コード", "荷主名"]);
    expect(rows.length - 1).toBe(total);
  });

  test("ひな形に沿って書いた CSV を確認してから登録でき、誤りがあれば登録できない", async ({ adminPage: page }) => {
    await page.goto("/orders");
    await page.getByRole("button", { name: /CSV 取り込み/ }).click();
    const dialog = page.getByRole("dialog");
    const [template] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("link", { name: /ひな形/ }).click()]);
    const [header, example] = await lines(template);
    const cols = example.split(",");
    const client = cols[0];
    const driver = cols[6];
    const day = jstDate(2).replaceAll("-", "/");
    const id = runId();
    const file = (rows: string[]) => ({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from(`﻿${[header, ...rows].join("\r\n")}`) });
    const result = dialog.getByRole("list", { name: "取り込む行の確認結果" });

    // 誤りのある行があると、1 行も登録できない
    await dialog.locator("input[type=file]").setInputFiles(
      file([
        `${client},,E2E取込 ${id} 正,東京都品川区東品川2-3-14,${day} 9:00,${day} 10:00,,,段ボール,3,4500,`,
        `存在しない荷主,,E2E取込 ${id} 誤,東京都港区芝浦1-1-1,${day} 9:00,${day} 8:00,,,段ボール,abc,1000,`,
      ]),
    );
    await expect(result).toBeVisible();
    await expect(dialog.getByText(/エラー\s*1\s*行/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: /件を登録する/ })).toBeDisabled();

    // 正しいファイルに差し替えると登録できる
    await dialog.getByRole("button", { name: "別のファイルを選ぶ" }).click();
    await dialog.locator("input[type=file]").setInputFiles(
      file([
        `${client},,E2E取込 ${id} 一,東京都品川区東品川2-3-14,${day} 9:00,${day} 10:00,${driver},,段ボール,3,4500,`,
        `${client},,E2E取込 ${id} 二,東京都江東区新木場1-5-1,${day} 13:00,${day} 15:00,,,パレット,1,12000,"改行を\n含む備考"`,
      ]),
    );
    await expect(result).toBeVisible();
    const ack = dialog.getByText(/内容を確認しました/);
    if (await ack.count()) await ack.click();
    await dialog.getByRole("button", { name: "2件を登録する" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "2件の案件を登録しました" })).toBeVisible();

    await page.goto(`/orders?q=${encodeURIComponent(`E2E取込 ${id}`)}`);
    expect(await readTotal(page)).toBe(2);
  });
});
