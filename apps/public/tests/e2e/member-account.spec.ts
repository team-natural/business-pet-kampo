import { expect, test } from "@playwright/test";
import { E2E_MEMBER } from "./global-setup";

// FG-01's screens. The service rules are pinned in tests/unit/member-auth.test.ts; what only a
// browser shows is that each island hydrates, and that the endpoints behave the same for an
// address that exists and one that does not (DEV-02 §7).
test.describe("password reset request", () => {
  test("the form hydrates and confirms without saying whether the address exists", async ({ page }) => {
    await page.goto("/login/forgot");

    const submit = page.getByRole("button", { name: "再設定メールを送る" });
    await expect(submit).toBeDisabled();

    await page.getByLabel("メールアドレス").fill("definitely-nobody@example.test");
    await expect(submit).toBeEnabled();
    await submit.click();

    // Worded to be true either way — that is the point.
    await expect(page.getByText(/アカウントが登録されている場合/)).toBeVisible();
  });

  test("a known and an unknown address get the same answer", async ({ request, baseURL }) => {
    const headers = { Origin: baseURL! };

    const known = await request.post("/api/v1/auth/password/forgot", { headers, data: { email: E2E_MEMBER.email } });
    const unknown = await request.post("/api/v1/auth/password/forgot", { headers, data: { email: "definitely-nobody@example.test" } });

    expect(known.status()).toBe(204);
    expect(unknown.status()).toBe(unknown.status() === 429 ? 429 : 204);
    // A body would be somewhere for a difference to hide.
    expect(await known.body()).toHaveLength(0);
  });

  test("a malformed address is a validation error, not a hint", async ({ request, baseURL }) => {
    const response = await request.post("/api/v1/auth/password/forgot", { headers: { Origin: baseURL! }, data: { email: "not-an-address" } });
    expect(response.status()).toBe(422);
  });
});

test.describe("password reset", () => {
  test("the form hydrates and refuses a token that was never issued", async ({ page }) => {
    await page.goto("/login/reset/not-a-real-token");

    const password = page.getByLabel("新しいパスワード", { exact: true });
    await password.fill("a-long-enough-password");
    await page.getByLabel("新しいパスワード（確認）").fill("a-long-enough-password");

    const submit = page.getByRole("button", { name: "パスワードを設定する" });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByRole("alert")).toContainText("このリンクは使用できません");
  });

  test("the confirmation field has to match before the button enables", async ({ page }) => {
    await page.goto("/login/reset/not-a-real-token");

    await page.getByLabel("新しいパスワード", { exact: true }).fill("a-long-enough-password");
    await page.getByLabel("新しいパスワード（確認）").fill("something-else-here");

    await expect(page.getByText("入力が一致しません。")).toBeVisible();
    await expect(page.getByRole("button", { name: "パスワードを設定する" })).toBeDisabled();
  });

  // The floor is the server's; the form mirrors it so it is known before submitting.
  test("a short password keeps the button disabled", async ({ page }) => {
    await page.goto("/login/reset/not-a-real-token");

    await page.getByLabel("新しいパスワード", { exact: true }).fill("short");
    await page.getByLabel("新しいパスワード（確認）").fill("short");

    await expect(page.getByRole("button", { name: "パスワードを設定する" })).toBeDisabled();
  });

  test("the endpoint refuses a short password even if the form is bypassed", async ({ request, baseURL }) => {
    const response = await request.post("/api/v1/auth/password/reset", { headers: { Origin: baseURL! }, data: { token: "whatever", password: "short" } });
    expect(response.status()).toBe(422);
  });
});

test.describe("activation", () => {
  test("the form hydrates and an unusable link is refused in the same words", async ({ page }) => {
    await page.goto("/activate/not-a-real-token");

    await page.getByLabel("新しいパスワード", { exact: true }).fill("a-long-enough-password");
    await page.getByLabel("新しいパスワード（確認）").fill("a-long-enough-password");

    const submit = page.getByRole("button", { name: "設定してはじめる" });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByRole("alert")).toContainText("このリンクは使用できません");
  });
});

test.describe("profile", () => {
  test("opens filled in and saves the name", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill(E2E_MEMBER.email);
    await page.getByLabel("パスワード").fill(E2E_MEMBER.password);
    await page.getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL("**/mypage");

    await page.goto("/mypage/profile");
    // Server-rendered from the session's own row, so the field is populated before hydration.
    await expect(page.getByLabel("メールアドレス")).toHaveValue(E2E_MEMBER.email);

    const save = page.getByRole("button", { name: "保存する" });
    await expect(save).toBeEnabled();
    await page.getByLabel("お名前").fill("E2E 太郎");
    await save.click();

    await expect(page.getByRole("status")).toContainText("アカウント情報を保存しました");
  });

  test("requires a session", async ({ request }) => {
    const response = await request.patch("/api/v1/me", { headers: { Origin: "http://localhost" }, data: { name: "誰か", email: "x@example.test" } });
    expect(response.status()).toBe(401);
  });
});
