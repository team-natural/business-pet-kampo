import { expect, test, type Page } from "@playwright/test";
import { E2E_MEMBER } from "./global-setup";

// The provider round trip itself cannot run here — it needs a real app registration, and the
// credentials are gitignored secrets (DEV-10 §5-2). What a browser can check is everything that
// happens before and after the provider: the allow-list, the state check, and that the screens
// say the right thing. The matching rules are in tests/unit/social-auth.test.ts.

async function login(page: Page) {
  await page.goto("/login");
  const submit = page.getByRole("button", { name: "ログイン" });
  await expect(submit).toBeEnabled();
  await page.getByLabel("メールアドレス").fill(E2E_MEMBER.email);
  await page.getByLabel("パスワード").fill(E2E_MEMBER.password);
  await submit.click();
  await page.waitForURL("**/mypage");
}

test.describe("the OAuth routes", () => {
  test("a provider outside the allow-list is 404 on both routes", async ({ page }) => {
    expect((await page.goto("/auth/github"))?.status()).toBe(404);
    expect((await page.goto("/auth/github/callback"))?.status()).toBe(404);
  });

  // The state cookie is set by /auth/{provider} and nowhere else, so a callback arriving without
  // one was not started here.
  test("a callback with no state cookie is refused before any exchange", async ({ page }) => {
    await page.goto("/auth/google/callback?code=forged&state=forged");

    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/login?error=oauth");
    await expect(page.getByRole("alert")).toContainText("ログインを完了できませんでした");
  });

  // A missing code, a mismatched state and a denied consent all answer the same way: telling them
  // apart tells whoever forged the callback which half was wrong.
  test("a callback with no code answers exactly as a mismatched one does", async ({ page }) => {
    await page.goto("/auth/google/callback?error=access_denied");
    expect(new URL(page.url()).search).toBe("?error=oauth");
  });
});

test.describe("the login screen", () => {
  test("offers the password form and the application route", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("button", { name: "ログイン" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "新規にお取引をご希望の方" })).toBeVisible();
  });

  // Shown before the password field rather than after: the member has to know why they are being
  // asked for it when they clicked a social button.
  test("explains itself when a social login asked for the password", async ({ page }) => {
    await page.goto("/login?link=google");
    await expect(page.getByRole("status")).toContainText("Google");
    await expect(page.getByRole("status")).toContainText("パスワードでログイン");
  });

  test("ignores a link parameter that is not a provider", async ({ page }) => {
    await page.goto("/login?link=github");
    await expect(page.getByRole("status")).toHaveCount(0);
  });
});

test.describe("the application screen", () => {
  test("explains the refusal without confirming whether the address is a customer", async ({ page }) => {
    await page.goto("/apply?reason=not_registered");

    const notice = page.getByRole("status");
    await expect(notice).toContainText("審査が必要です");
    // No wording that separates "never applied" from "suspended" (DEV-02 §7).
    await expect(notice).not.toContainText("停止");
    await expect(notice).not.toContainText("登録されていません");
  });
});

test.describe("mypage", () => {
  test("shows which providers are linked", async ({ page }) => {
    await login(page);
    await page.goto("/mypage/profile");

    await expect(page.getByRole("heading", { name: "連携済みのログイン方法" })).toBeVisible();
    // The seeded member has no social account, and none is created by logging in with a password.
    await expect(page.getByText("連携しているアカウントはありません")).toBeVisible();
  });
});
