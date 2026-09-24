import { expect, test, type Page } from "@playwright/test";
import { E2E_MEMBER } from "./global-setup";

// FG-04's screens. The arithmetic and the scoping are pinned in tests/unit/cart.test.ts; what only
// a browser shows is that the panel hydrates, that the figures the page prints match
// lib/commerce.ts, and that a wholesale price never reaches an island's props (D-021).
//
// The seeded organization has no price file, so the standard wholesale prices apply.
const JOINT_CARE = { slug: "sample-joint-care", unitPrice: 2_400, orderUnit: 10 };

async function login(page: Page) {
  await page.goto("/login");
  const submit = page.getByRole("button", { name: "ログイン" });
  await expect(submit).toBeEnabled();
  await page.getByLabel("メールアドレス").fill(E2E_MEMBER.email);
  await page.getByLabel("パスワード").fill(E2E_MEMBER.password);
  await submit.click();
  await page.waitForURL("**/mypage");
}

// workers: 1 means every test shares one cart, so each starts from empty rather than assuming it.
// Origin is required even on a DELETE: without it Astro's CSRF check answers 403, and a teardown
// that fails quietly leaves the next test to inherit the rows.
async function emptyCart(page: Page, baseURL: string) {
  const response = await page.request.get("/api/v1/cart");
  const body = (await response.json()) as { data: { lines: { id: number }[]; unavailable: { id: number }[] } };

  for (const row of [...body.data.lines, ...body.data.unavailable]) {
    const deleted = await page.request.delete(`/api/v1/cart/items/${row.id}`, { headers: { Origin: baseURL } });
    expect(deleted.status()).toBe(204);
  }
}

test.beforeEach(async ({ page, baseURL }) => {
  await login(page);
  await emptyCart(page, baseURL!);
});

test.describe("adding to the cart", () => {
  test("the product panel hydrates and adds the order unit", async ({ page }) => {
    await page.goto(`/products/${JOINT_CARE.slug}`);

    const submit = page.getByRole("button", { name: "カートに追加" });
    await expect(submit).toBeEnabled();
    await expect(page.getByLabel(/数量/)).toHaveValue(String(JOINT_CARE.orderUnit));

    await submit.click();
    await expect(page.getByRole("status")).toContainText("カートに追加しました");
  });

  test("the panel carries no wholesale price into the island's props", async ({ page }) => {
    await page.goto(`/products/${JOINT_CARE.slug}`);

    // The price is on the page — it is server-rendered — but must not appear inside the island's
    // serialised props, which a cache would hand to the next reader (D-021).
    const props = await page.locator("astro-island").first().getAttribute("props");
    expect(props).not.toContain(String(JOINT_CARE.unitPrice));
    expect(props).toContain(JOINT_CARE.slug);
  });

  test("a quantity that is not a multiple of the order unit is refused, not rounded", async ({ page, baseURL }) => {
    const response = await page.request.post("/api/v1/cart/items", { headers: { Origin: baseURL! }, data: { productSlug: JOINT_CARE.slug, quantity: 5 } });

    expect(response.status()).toBe(422);
    expect(await page.request.get("/api/v1/cart").then((r) => r.json())).toMatchObject({ data: { lines: [] } });
  });

  // product_slug has no foreign key; the service's lookup is the only thing standing in for one.
  test("a slug that does not resolve is 400", async ({ page, baseURL }) => {
    const response = await page.request.post("/api/v1/cart/items", { headers: { Origin: baseURL! }, data: { productSlug: "never-existed", quantity: 10 } });
    expect(response.status()).toBe(400);
  });

  test("requires a session", async ({ request, baseURL }) => {
    const response = await request.post("/api/v1/cart/items", { headers: { Origin: baseURL! }, data: { productSlug: JOINT_CARE.slug, quantity: 10 } });
    expect(response.status()).toBe(401);
  });
});

test.describe("the cart screen", () => {
  test("prints the figures lib/commerce.ts computes, and updates them on a quantity change", async ({ page, baseURL }) => {
    await page.request.post("/api/v1/cart/items", { headers: { Origin: baseURL! }, data: { productSlug: JOINT_CARE.slug, quantity: 10 } });
    await page.goto("/cart");

    // 24,000 tax-exclusive: under the free-shipping threshold, so 1,000 shipping and 10% on both.
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
    await expect(page.getByText("24,000 円").first()).toBeVisible();
    await expect(page.getByText("2,500 円")).toBeVisible();
    await expect(page.getByText("27,500 円")).toBeVisible();

    const quantity = page.getByLabel(/数量/);
    await expect(quantity).toBeEnabled();
    await quantity.fill("20");
    await page.getByRole("button", { name: "数量を更新" }).click();

    // 48,000 clears the free-shipping threshold, so the fee goes and the tax is 10% of the goods.
    await expect(page.getByText("48,000 円").first()).toBeVisible();
    await expect(page.getByText("4,800 円")).toBeVisible();
    await expect(page.getByText("52,800 円")).toBeVisible();
  });

  // The refusal below the minimum is in tests/unit/cart.test.ts: the smallest line the real
  // fixtures allow is 2,400 × 10, which already clears ¥10,000, so a browser cannot get under it.
  test("opens checkout once the minimum order value is met", async ({ page, baseURL }) => {
    await page.request.post("/api/v1/cart/items", { headers: { Origin: baseURL! }, data: { productSlug: JOINT_CARE.slug, quantity: 10 } });
    await page.goto("/cart");

    await expect(page.getByRole("link", { name: "ご発注手続きへ" })).toBeVisible();
  });

  test("removes a line", async ({ page, baseURL }) => {
    await page.request.post("/api/v1/cart/items", { headers: { Origin: baseURL! }, data: { productSlug: JOINT_CARE.slug, quantity: 10 } });
    await page.goto("/cart");

    await page.getByRole("button", { name: "削除" }).click();
    await expect(page.getByText("カートは空です")).toBeVisible();
  });

  test("shows an empty cart rather than an error", async ({ page }) => {
    await page.goto("/cart");
    await expect(page.getByText("カートは空です")).toBeVisible();
  });
});
