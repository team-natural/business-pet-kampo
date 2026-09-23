import { expect, test, type Page } from "@playwright/test";
import { E2E_MEMBER } from "./global-setup";

// login-form.svelte keeps the button disabled until onMount, so "enabled" is the hydration
// signal — and the only check that catches a page missing its client:* directive.
async function login(page: Page, email: string, password: string) {
  const submit = page.getByRole("button", { name: "ログイン" });
  await expect(submit).toBeEnabled();
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await submit.click();
}

test.describe("member login", () => {
  test("wrong credentials stay on the login screen and reveal nothing", async ({ page }) => {
    await page.goto("/login");
    await login(page, E2E_MEMBER.email, "not-the-password");

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(E2E_MEMBER.email);
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("correct credentials reach the member page with an HttpOnly session cookie", async ({ page, context }) => {
    await page.goto("/login");
    await login(page, E2E_MEMBER.email, E2E_MEMBER.password);

    await page.waitForURL("**/mypage");
    await expect(page.getByText(E2E_MEMBER.email)).toBeVisible();

    const cookie = (await context.cookies()).find((c) => c.name === "member_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
  });

  test("member pages are never handed to a shared cache", async ({ page }) => {
    // Unlike the admin subdomain, this origin is cacheable by default.
    await page.goto("/login");
    await login(page, E2E_MEMBER.email, E2E_MEMBER.password);
    await page.waitForURL("**/mypage");

    const response = await page.goto("/mypage");
    expect(response?.headers()["cache-control"]).toContain("no-store");
  });

  test("the member page redirects when unauthenticated, uncacheably", async ({ page, request }) => {
    // Guarded in the page frontmatter, so this holds regardless of client-side JS.
    await page.goto("/mypage");
    expect(new URL(page.url()).pathname).toBe("/login");

    // The redirect itself must not be cacheable either — a shared cache would otherwise pin
    // one visitor's authenticated/anonymous answer for everyone.
    const redirect = await request.get("/mypage", { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers()["cache-control"]).toContain("no-store");
  });

  test("a forged session cookie authenticates nobody", async ({ page, context, baseURL }) => {
    // The cookie carries a token, not an identity: every request re-reads member_sessions, so a
    // made-up value has nothing to match.
    await context.addCookies([{ name: "member_session", value: "not-a-real-session-token", url: baseURL! }]);
    await page.goto("/mypage");

    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("logging out revokes the session, not just the cookie", async ({ page }) => {
    await page.goto("/login");
    await login(page, E2E_MEMBER.email, E2E_MEMBER.password);
    await page.waitForURL("**/mypage");

    await page.getByRole("button", { name: "ログアウト" }).click();
    await page.waitForURL(/\/$/);

    await page.goto("/mypage");
    expect(new URL(page.url()).pathname).toBe("/login");
  });
});

test.describe("public site", () => {
  test("the top page renders", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "商品を見る" })).toBeVisible();
  });

  test("the middleware's security headers are present", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("the contact endpoint accepts a post from a visitor with no session", async ({ request, baseURL }) => {
    // The one unauthenticated write on this site, so here a 401 would be the bug. Astro's CSRF
    // check still applies, hence the Origin.
    const headers = { Origin: baseURL! };
    const created = await request.post("/api/v1/inquiries", {
      headers,
      data: { companyName: "E2E 商店", name: "Visitor", email: "visitor@example.test", inquiryType: "product", content: "Hello" },
    });
    expect(created.status()).toBe(201);
    expect((await created.json()).data.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const invalid = await request.post("/api/v1/inquiries", { headers, data: { name: "V", email: "nope", content: "" } });
    expect(invalid.status()).toBe(422);

    // A type outside lib/inquiry.ts would file the row under a category no screen can render.
    const unknownType = await request.post("/api/v1/inquiries", { headers, data: { name: "V", email: "visitor@example.test", inquiryType: "not-a-type", content: "Hello" } });
    expect(unknownType.status()).toBe(422);
  });

  test("a product detail page renders from its Content Collections entry", async ({ page }) => {
    await page.goto("/products");
    await page.getByRole("link", { name: /サンプル 関節ケア/ }).click();

    await expect(page.getByRole("heading", { level: 1, name: /サンプル 関節ケア/ })).toBeVisible();
  });

  test("an anonymous visitor is shown no wholesale price", async ({ page }) => {
    // Also catches an accidental `prerender = true`: a static product page would carry every
    // organization's price in its HTML (D-021).
    const response = await page.goto("/products/sample-joint-care");
    const html = (await response?.text()) ?? "";

    expect(html).not.toContain("2,400");
    expect(html).not.toContain("2,200");
    await expect(page.getByText("卸価格は承認済みの取引先アカウントでご確認いただけます。")).toBeVisible();
  });

  test("the pages that are prerendered still answer", async ({ request }) => {
    // getStaticPaths is silently ignored under output: "server", so a page meant to be static is
    // only proven by requesting it (DEV-06 §1-1).
    for (const path of ["/faq", "/terms", "/privacy", "/law", "/diagnosis"]) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });
});
