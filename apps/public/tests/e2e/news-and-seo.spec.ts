import { expect, test, type Page } from "@playwright/test";
import { E2E_MEMBER } from "./global-setup";

// FG-09 and the SEO surface. The exit condition for this stage is that `draft` and `client_only`
// are excluded in all three places — the listing, the detail URL and the sitemap — so each one is
// asserted separately. Filtering only the listing leaves the detail URL live (D-018).
const NEWS = {
  public: "2026-09-17-sample",
  clientOnly: "2026-09-18-sample-client-only",
  draft: "2026-09-19-sample-draft",
};

async function login(page: Page) {
  await page.goto("/login");
  const submit = page.getByRole("button", { name: "ログイン" });
  await expect(submit).toBeEnabled();
  await page.getByLabel("メールアドレス").fill(E2E_MEMBER.email);
  await page.getByLabel("パスワード").fill(E2E_MEMBER.password);
  await submit.click();
  await page.waitForURL("**/mypage");
}

test.describe("sitemap.xml", () => {
  test("lists the public pages that @astrojs/sitemap could not have found", async ({ request }) => {
    const response = await request.get("/sitemap.xml");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/xml");

    const body = await response.text();
    // The two dynamic, SSR-only routes. An integration-generated sitemap would contain neither.
    expect(body).toContain("/products/sample-joint-care");
    expect(body).toContain(`/news/${NEWS.public}`);
    expect(body).toContain("<loc>");
  });

  test("excludes draft and partner-only entries", async ({ request }) => {
    const body = await (await request.get("/sitemap.xml")).text();

    expect(body).not.toContain(NEWS.clientOnly);
    expect(body).not.toContain(NEWS.draft);
  });

  test("excludes every member and transaction route", async ({ request }) => {
    const body = await (await request.get("/sitemap.xml")).text();

    for (const path of ["/mypage", "/cart", "/checkout", "/login", "/api/"]) {
      expect(body).not.toContain(path);
    }
  });
});

test.describe("robots.txt", () => {
  test("points at the sitemap and disallows the private areas", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toMatch(/^Sitemap: https?:\/\/.+\/sitemap\.xml$/m);
    expect(body).toContain("Disallow: /mypage/");
    expect(body).toContain("Disallow: /api/");
  });
});

test.describe("news for an anonymous visitor", () => {
  test("the listing shows public entries only", async ({ page }) => {
    await page.goto("/news");

    await expect(page.getByRole("link", { name: /サンプルのお知らせ/ })).toBeVisible();
    await expect(page.getByText("サンプルの取引先限定お知らせ")).toHaveCount(0);
    await expect(page.getByText("サンプルの下書きお知らせ")).toHaveCount(0);
  });

  // Filtering the listing alone would leave this URL live and readable.
  test("a partner-only entry's own URL is 404, not 403", async ({ page }) => {
    expect((await page.goto(`/news/${NEWS.clientOnly}`))?.status()).toBe(404);
  });

  test("a draft's URL is 404", async ({ page }) => {
    expect((await page.goto(`/news/${NEWS.draft}`))?.status()).toBe(404);
  });

  test("a public entry renders its body", async ({ page }) => {
    const response = await page.goto(`/news/${NEWS.public}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "サンプルのお知らせ", level: 1 })).toBeVisible();
  });
});

test.describe("news for a signed-in member", () => {
  test("the listing adds the partner-only entries, labelled", async ({ page }) => {
    await login(page);
    await page.goto("/news");

    await expect(page.getByText("サンプルの取引先限定お知らせ")).toBeVisible();
    await expect(page.getByText("取引先限定").first()).toBeVisible();
    // draft is not "unpublished for outsiders" — it is out for everyone.
    await expect(page.getByText("サンプルの下書きお知らせ")).toHaveCount(0);
  });

  test("the partner-only entry opens, and is marked not to be indexed", async ({ page }) => {
    await login(page);
    const response = await page.goto(`/news/${NEWS.clientOnly}`);

    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    expect(response?.headers()["cache-control"]).toContain("no-store");
  });

  test("mypage summarises the news the member may see", async ({ page }) => {
    await login(page);
    await expect(page.getByRole("link", { name: /サンプルの取引先限定お知らせ/ })).toBeVisible();
  });
});

test.describe("member routes are kept out of the index", () => {
  test("mypage answers with a noindex header", async ({ page }) => {
    await login(page);
    const response = await page.goto("/mypage");

    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  });

  // The header has to survive a redirect, which is why it is set in middleware rather than in a
  // page's frontmatter.
  test("the redirect an unauthenticated visitor gets is noindex too", async ({ request }) => {
    const response = await request.get("/mypage", { maxRedirects: 0 });

    expect(response.status()).toBe(302);
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
  });
});
