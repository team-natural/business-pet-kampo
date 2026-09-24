import { expect, test, type Page } from "@playwright/test";
import { E2E_MEMBER } from "./global-setup";

// FG-04's ordering half, end to end. The arithmetic, the snapshots and the scoping are pinned in
// tests/unit/checkout.test.ts; what only a browser shows is that the form hydrates, that the
// completion screen carries the payment instruction, and that the wholesale price never reaches an
// island's props (D-021).
//
// The seeded organization has no price file, so the standard wholesale price applies.
const JOINT_CARE = { slug: "sample-joint-care", orderUnit: 10 };

async function login(page: Page) {
  await page.goto("/login");
  const submit = page.getByRole("button", { name: "ログイン" });
  await expect(submit).toBeEnabled();
  await page.getByLabel("メールアドレス").fill(E2E_MEMBER.email);
  await page.getByLabel("パスワード").fill(E2E_MEMBER.password);
  await submit.click();
  await page.waitForURL("**/mypage");
}

// Origin is required even on a DELETE: without it Astro's CSRF check answers 403, and a teardown
// that fails quietly leaves the next spec to inherit the rows.
async function reset(page: Page, baseURL: string) {
  const headers = { Origin: baseURL };

  const cart = (await (await page.request.get("/api/v1/cart")).json()) as { data: { lines: { id: number }[]; unavailable: { id: number }[] } };
  for (const row of [...cart.data.lines, ...cart.data.unavailable]) {
    await page.request.delete(`/api/v1/cart/items/${row.id}`, { headers });
  }

  // mypage.spec.ts asserts that the first address an organization adds becomes its default, so
  // this spec must not leave one behind.
  const addresses = (await (await page.request.get("/api/v1/addresses")).json()) as { data: { id: string }[] };
  for (const address of addresses.data) {
    await page.request.delete(`/api/v1/addresses/${address.id}`, { headers });
  }
}

async function addAddress(page: Page, baseURL: string) {
  const response = await page.request.post("/api/v1/addresses", {
    headers: { Origin: baseURL },
    data: { recipientName: "E2E 受取", postalCode: "1000001", address: "東京都千代田区1-1-1", phone: "0312345678", isDefault: 1 },
  });
  expect(response.status()).toBe(201);
}

async function fillCart(page: Page, baseURL: string, quantity = JOINT_CARE.orderUnit) {
  const response = await page.request.post("/api/v1/cart/items", { headers: { Origin: baseURL }, data: { productSlug: JOINT_CARE.slug, quantity } });
  expect(response.status()).toBe(201);
}

test.beforeEach(async ({ page, baseURL }) => {
  await login(page);
  await reset(page, baseURL!);
});

test.afterEach(async ({ page, baseURL }) => {
  await reset(page, baseURL!);
});

test.describe("the confirmation screen", () => {
  test("shows the totals and hydrates the form", async ({ page, baseURL }) => {
    await addAddress(page, baseURL!);
    await fillCart(page, baseURL!);
    await page.goto("/checkout");

    // 2,400 × 10 = 24,000; under the free-shipping threshold, so 1,000 shipping and 10% on both.
    await expect(page.getByText("24,000 円").first()).toBeVisible();
    await expect(page.getByText("27,500 円")).toBeVisible();

    await expect(page.getByRole("button", { name: "この内容で発注する" })).toBeEnabled();
    // Card payment ships in S11 — listed so the buyer sees it is coming, but not selectable.
    await expect(page.getByRole("radio", { name: /クレジットカード決済/ })).toBeDisabled();
    await expect(page.getByRole("radio", { name: /銀行振込/ })).toBeEnabled();
  });

  test("sends an empty cart back rather than showing a live button", async ({ page }) => {
    await page.goto("/checkout");
    expect(new URL(page.url()).pathname).toBe("/cart");
  });

  test("carries no wholesale price into the island's props", async ({ page, baseURL }) => {
    await addAddress(page, baseURL!);
    await fillCart(page, baseURL!);
    await page.goto("/checkout");

    const props = await page.locator("astro-island").first().getAttribute("props");
    expect(props).not.toContain("2400");
    expect(props).not.toContain("24000");
  });
});

test.describe("placing an order", () => {
  test("confirms with the order number, the account and the reference rule", async ({ page, baseURL }) => {
    await addAddress(page, baseURL!);
    await fillCart(page, baseURL!);
    await page.goto("/checkout");

    await page.getByRole("button", { name: "この内容で発注する" }).click();
    await page.waitForURL("**/checkout/thanks**");

    const orderNumber = new URL(page.url()).searchParams.get("order")!;
    expect(orderNumber).toMatch(/^\d{8}-\d{3,}$/);

    await expect(page.getByText(orderNumber).first()).toBeVisible();
    await expect(page.getByText("27,500 円")).toBeVisible();
    // The instruction the buyer's accounts department needs (D-039).
    await expect(page.getByText("お振込期限")).toBeVisible();
    await expect(page.getByText("サンプル銀行")).toBeVisible();
    await expect(page.getByText(`振込依頼人名の先頭に注文番号「${orderNumber}」`)).toBeVisible();

    // The cart is emptied by the same batch that wrote the order.
    const cart = (await (await page.request.get("/api/v1/cart")).json()) as { data: { lines: unknown[] } };
    expect(cart.data.lines).toHaveLength(0);
  });

  test("the order then appears in the history with its snapshot", async ({ page, baseURL }) => {
    await addAddress(page, baseURL!);
    await fillCart(page, baseURL!);
    await page.goto("/checkout");
    await page.getByRole("button", { name: "この内容で発注する" }).click();
    await page.waitForURL("**/checkout/thanks**");

    // Located by its number rather than by position: orders accumulate across the run, and the
    // history is the organization's, not this test's.
    const orderNumber = new URL(page.url()).searchParams.get("order")!;

    await page.goto("/mypage/orders");
    await page.getByTestId("order-row").filter({ hasText: orderNumber }).getByRole("link").click();

    await expect(page.getByText("サンプル 関節ケア（犬用）")).toBeVisible();
    await expect(page.getByText("E2E 受取")).toBeVisible();
    await expect(page.getByText("27,500 円")).toBeVisible();
  });

  test("summarises on the mypage top", async ({ page, baseURL }) => {
    await addAddress(page, baseURL!);
    await fillCart(page, baseURL!);
    await page.goto("/checkout");
    await page.getByRole("button", { name: "この内容で発注する" }).click();
    await page.waitForURL("**/checkout/thanks**");

    await page.goto("/mypage");
    await expect(page.getByRole("heading", { name: "最近のご発注" })).toBeVisible();
  });
});

test.describe("the endpoint decides, not the screen", () => {
  test("refuses a cart below the minimum with 409", async ({ page, baseURL }) => {
    await addAddress(page, baseURL!);
    const addresses = (await (await page.request.get("/api/v1/addresses")).json()) as { data: { id: string }[] };

    // No cart at all is the same class of refusal and the only one the real fixtures can reach:
    // the smallest line is 2,400 × 10, which already clears ¥10,000.
    const response = await page.request.post("/api/v1/checkout", { headers: { Origin: baseURL! }, data: { shippingAddressId: addresses.data[0]!.id, paymentMethod: "bank_transfer" } });
    expect(response.status()).toBe(409);
  });

  test("refuses an address that is not this organization's, with 404", async ({ page, baseURL }) => {
    await fillCart(page, baseURL!);

    const response = await page.request.post("/api/v1/checkout", { headers: { Origin: baseURL! }, data: { shippingAddressId: "01E2EADDROTHER000000000000", paymentMethod: "bank_transfer" } });
    expect(response.status()).toBe(404);
  });

  test("requires a session", async ({ request, baseURL }) => {
    const response = await request.post("/api/v1/checkout", { headers: { Origin: baseURL! }, data: { shippingAddressId: "whatever", paymentMethod: "bank_transfer" } });
    expect(response.status()).toBe(401);
  });
});
