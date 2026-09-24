import { expect, test, type Page } from "@playwright/test";
import { E2E_MEMBER, E2E_ORGANIZATIONS, E2E_OTHER_ADDRESS } from "./global-setup";

// FG-05's screens. The service rules are pinned in tests/unit/addresses.test.ts; what only a
// browser shows is that each island hydrates, and that another organization's address is missing
// rather than refused — a 403 would confirm the id exists (DEV-02 §3-1).
async function login(page: Page) {
  await page.goto("/login");
  const submit = page.getByRole("button", { name: "ログイン" });
  await expect(submit).toBeEnabled();
  await page.getByLabel("メールアドレス").fill(E2E_MEMBER.email);
  await page.getByLabel("パスワード").fill(E2E_MEMBER.password);
  await submit.click();
  await page.waitForURL("**/mypage");
}

// Each spec leaves the list as it found it, because workers: 1 means they share one organization.
async function addAddress(page: Page, recipientName: string, options: { isDefault?: boolean } = {}) {
  await page.goto("/mypage/addresses/new");

  const submit = page.getByRole("button", { name: "登録する" });
  await expect(submit).toBeEnabled();

  await page.getByLabel("宛名").fill(recipientName);
  await page.getByLabel("郵便番号").fill("1000001");
  await page.getByLabel("住所").fill("東京都千代田区1-1-1");
  await page.getByLabel("電話番号").fill("0312345678");
  if (options.isDefault) await page.getByLabel("既定の配送先にする").check();

  await submit.click();
  await page.waitForURL("**/mypage/addresses");
}

async function removeAddress(page: Page, recipientName: string) {
  const row = page.getByTestId("address-row").filter({ hasText: recipientName });
  await row.getByRole("button", { name: "削除" }).click();
  await row.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByTestId("address-row").filter({ hasText: recipientName })).toHaveCount(0);
}

test.describe("mypage top", () => {
  test("shows the organization and links to each member screen", async ({ page }) => {
    await login(page);

    await expect(page.getByText(E2E_ORGANIZATIONS.mine.orgCode)).toBeVisible();
    await expect(page.getByRole("link", { name: /配送先/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /会社・取引先情報/ })).toBeVisible();
  });
});

test.describe("shipping addresses", () => {
  test("adds, promotes and deletes, keeping exactly one default", async ({ page }) => {
    await login(page);

    await addAddress(page, "E2E 配送先 A");
    // The first address is the default whether or not the box was ticked, so checkout has
    // something to preselect.
    await expect(page.getByTestId("address-row").filter({ hasText: "E2E 配送先 A" })).toContainText("既定");

    await addAddress(page, "E2E 配送先 B");
    const second = page.getByTestId("address-row").filter({ hasText: "E2E 配送先 B" });
    await second.getByRole("button", { name: "既定にする" }).click();

    await expect(second).toContainText("既定");
    await expect(page.getByText("既定", { exact: true })).toHaveCount(1);

    await removeAddress(page, "E2E 配送先 B");
    // Deleting the default promotes what is left, rather than leaving the organization with none.
    await expect(page.getByTestId("address-row").filter({ hasText: "E2E 配送先 A" })).toContainText("既定");
    await removeAddress(page, "E2E 配送先 A");
  });

  test("the edit form opens filled in and cannot untick the current default", async ({ page }) => {
    await login(page);
    await addAddress(page, "E2E 配送先 C");

    await page.getByTestId("address-row").filter({ hasText: "E2E 配送先 C" }).getByRole("link", { name: "編集" }).click();
    // Server-rendered from the row itself, so the fields are populated before hydration.
    await expect(page.getByLabel("宛名")).toHaveValue("E2E 配送先 C");
    await expect(page.getByLabel("既定の配送先にする")).toBeDisabled();

    await page.getByLabel("宛名").fill("E2E 配送先 C2");
    await page.getByRole("button", { name: "保存する" }).click();
    await page.waitForURL("**/mypage/addresses");

    await expect(page.getByTestId("address-row").filter({ hasText: "E2E 配送先 C2" })).toBeVisible();
    await removeAddress(page, "E2E 配送先 C2");
  });

  test("another organization's address is 404, not 403", async ({ page, baseURL }) => {
    await login(page);

    const editPage = await page.goto(`/mypage/addresses/${E2E_OTHER_ADDRESS}/edit`);
    expect(editPage?.status()).toBe(404);

    // page.request, not the `request` fixture: the fixture has its own cookie jar, so these would
    // answer 401 and the scoping rule would go untested.
    const headers = { Origin: baseURL! };
    const patched = await page.request.patch(`/api/v1/addresses/${E2E_OTHER_ADDRESS}`, { headers, data: { recipientName: "乗っ取り", postalCode: "1000001", address: "東京都千代田区1-1-1", phone: "0312345678" } });
    expect(patched.status()).toBe(404);

    const deleted = await page.request.delete(`/api/v1/addresses/${E2E_OTHER_ADDRESS}`, { headers, data: {} });
    expect(deleted.status()).toBe(404);
  });

  test("requires a session", async ({ request, baseURL }) => {
    const response = await request.get("/api/v1/addresses", { headers: { Origin: baseURL! } });
    expect(response.status()).toBe(401);
  });
});

test.describe("company information", () => {
  test("submitting a change leaves the displayed details alone", async ({ page }) => {
    await login(page);
    await page.goto("/mypage/company");

    const stored = `E2E 取引先 ${E2E_ORGANIZATIONS.mine.orgCode}`;
    await expect(page.getByRole("definition").filter({ hasText: stored })).toBeVisible();

    const submit = page.getByRole("button", { name: "変更を申請する" });
    await expect(submit).toBeEnabled();
    await page.getByLabel("会社名").fill("E2E 商事株式会社");
    await submit.click();

    await expect(page.getByRole("status")).toContainText("承りました");

    // Nothing moved: the operator confirms contract data before it applies (D-035).
    await page.reload();
    await expect(page.getByRole("definition").filter({ hasText: stored })).toBeVisible();
  });

  // The empty-request rule is covered in the unit tests, where a session can be arranged; here
  // the point is that authentication answers before any of it.
  test("requires a session", async ({ request, baseURL }) => {
    const response = await request.patch("/api/v1/me/company", { headers: { Origin: baseURL! }, data: {} });
    expect(response.status()).toBe(401);
  });
});
