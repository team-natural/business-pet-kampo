import { expect, test } from "@playwright/test";

// FG-02's visitor half. The form is an island, so the hydration check is the only thing that
// catches a missing client:* directive (DEV-03 §3-5).
const valid = {
  companyName: "E2E 商店",
  postalCode: "1000001",
  address: "東京都千代田区1-1-1",
  representativeName: "山田 太郎",
  contactName: "佐藤 花子",
  phone: "0312345678",
  email: "applicant@example.test",
  agreedToTerms: 1,
};

test.describe("new trading application", () => {
  test("the form hydrates and submits through to the completion page", async ({ page }) => {
    await page.goto("/apply");

    const submit = page.getByRole("button", { name: "この内容で申し込む" });
    // Disabled until onMount runs. Enabled here means the island's JS actually loaded.
    await expect(submit).toBeEnabled();

    await page.getByLabel("会社名").fill(valid.companyName);
    await page.getByLabel("郵便番号").fill(valid.postalCode);
    await page.getByLabel("住所").fill(valid.address);
    await page.getByLabel("代表者名").fill(valid.representativeName);
    await page.getByLabel("ご担当者名").fill(valid.contactName);
    await page.getByLabel("電話番号").fill(valid.phone);
    await page.getByLabel("メールアドレス").fill(valid.email);
    await page.getByRole("checkbox", { name: /同意します/ }).check();
    await submit.click();

    await page.waitForURL("**/apply/complete");
    await expect(page.getByRole("heading", { level: 1, name: "お申し込みを受け付けました" })).toBeVisible();
  });

  test("the endpoint accepts a submission from a visitor with no session", async ({ request, baseURL }) => {
    const headers = { Origin: baseURL! };
    const created = await request.post("/api/v1/applications", { headers, data: { ...valid, agreedTermsVersion: "2026-09-17" } });

    expect(created.status()).toBe(201);
    const body = await created.json();
    expect(body.data.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(body.data.status).toBe("received");
  });

  test("a stale terms version is refused with 409, not stored", async ({ request, baseURL }) => {
    // A form left open across a terms revision. Storing it would record consent to wording that
    // cannot be reconstructed (DEV-04 §6-1).
    const stale = await request.post("/api/v1/applications", { headers: { Origin: baseURL! }, data: { ...valid, agreedTermsVersion: "2020-01-01" } });

    expect(stale.status()).toBe(409);
    expect((await stale.json()).error_code).toBe("CONFLICT");
  });

  test("an incomplete submission answers 422", async ({ request, baseURL }) => {
    const invalid = await request.post("/api/v1/applications", { headers: { Origin: baseURL! }, data: { companyName: "", email: "nope", agreedTermsVersion: "2026-09-17" } });
    expect(invalid.status()).toBe(422);
  });

  // `status` is server-set, so a visitor cannot arrive pre-approved.
  test("a posted status is ignored", async ({ request, baseURL }) => {
    const created = await request.post("/api/v1/applications", { headers: { Origin: baseURL! }, data: { ...valid, agreedTermsVersion: "2026-09-17", status: "approved" } });

    expect(created.status()).toBe(201);
    expect((await created.json()).data.status).toBe("received");
  });
});

test.describe("application withdrawal", () => {
  // Every failure looks like a success from outside, which is the whole point (DEV-04 §5-3).
  test("a forged token answers 204, the same as a real one", async ({ request, baseURL }) => {
    const response = await request.delete("/api/v1/applications/01HZZZZZZZZZZZZZZZZZZZZZZZ", { headers: { Origin: baseURL! }, data: { token: "forged.token" } });
    expect(response.status()).toBe(204);
  });

  test("the cancel page renders the same for an unusable token", async ({ page }) => {
    // No error page, no "this link expired" — that would confirm which links are live.
    await page.goto("/apply/cancel/not-a-real-token");

    await expect(page.getByRole("heading", { level: 1, name: "お申し込みの取消" })).toBeVisible();
    await expect(page.getByRole("button", { name: "お申し込みを取り消す" })).toBeEnabled();
  });
});
