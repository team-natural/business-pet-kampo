import { expect, test, type Page } from "@playwright/test";
import { E2E_MEMBER } from "./global-setup";

// SCR-20. The recording rules are pinned in tests/unit/addresses.test.ts; what only a browser
// shows is that the destructive action asks twice, and that submitting it leaves the account
// working — the operator's side owns the actual termination (F-12-02, DEV-09 §2-2).
async function login(page: Page) {
  await page.goto("/login");
  const submit = page.getByRole("button", { name: "ログイン" });
  await expect(submit).toBeEnabled();
  await page.getByLabel("メールアドレス").fill(E2E_MEMBER.email);
  await page.getByLabel("パスワード").fill(E2E_MEMBER.password);
  await submit.click();
  await page.waitForURL("**/mypage");
}

test.describe("the withdrawal screen", () => {
  test("is reachable from the account screen and says what termination costs", async ({ page }) => {
    await login(page);
    await page.goto("/mypage/profile");

    await page.getByRole("link", { name: "退会・取引終了について" }).click();
    await page.waitForURL("**/mypage/withdrawal");

    // The three consequences the buyer needs before pressing anything.
    await expect(page.getByText("未入金のご発注が残っている場合")).toBeVisible();
    await expect(page.getByText("すべてのご担当者がログインできなくなります")).toBeVisible();
    await expect(page.getByText("あらためて新規のお申し込みが必要です")).toBeVisible();
  });

  // One click is the wrong shape for ending a company's trading, and `terminated` is terminal.
  test("asks twice before sending", async ({ page }) => {
    await login(page);
    await page.goto("/mypage/withdrawal");

    const open = page.getByRole("button", { name: "退会・取引終了を申し出る" });
    await expect(open).toBeEnabled();
    await open.click();

    // The confirmation names the organization, so it cannot be mistaken for closing one account.
    await expect(page.getByRole("alert")).toContainText("E2E 取引先");
    await expect(page.getByRole("button", { name: "この内容で申し出る" })).toBeEnabled();
  });

  test("can be backed out of", async ({ page }) => {
    await login(page);
    await page.goto("/mypage/withdrawal");

    await page.getByRole("button", { name: "退会・取引終了を申し出る" }).click();
    await page.getByRole("button", { name: "やめる" }).click();

    await expect(page.getByRole("button", { name: "退会・取引終了を申し出る" })).toBeVisible();
    await expect(page.getByRole("button", { name: "この内容で申し出る" })).toHaveCount(0);
  });

  test("confirms the request and leaves the account working", async ({ page }) => {
    await login(page);
    await page.goto("/mypage/withdrawal");

    await page.getByLabel("お申し出の理由（任意）").fill("E2E からの申し出");
    await page.getByRole("button", { name: "退会・取引終了を申し出る" }).click();
    await page.getByRole("button", { name: "この内容で申し出る" }).click();

    await expect(page.getByRole("status")).toContainText("お申し出を承りました");
    // Nothing moved: the member can still reach the member-only screens.
    await expect(page.getByRole("status")).toContainText("これまでどおりご利用いただけます");

    const response = await page.request.get("/api/v1/me/company");
    expect(response.status()).toBe(200);
    expect((await response.json()).data.status).toBe("active");
  });

  test("requires a session", async ({ request, baseURL }) => {
    const response = await request.post("/api/v1/me/withdrawal", { headers: { Origin: baseURL! }, data: {} });
    expect(response.status()).toBe(401);
  });
});
