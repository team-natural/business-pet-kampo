import { expect, test } from "@playwright/test";
import { E2E_APPLICATIONS } from "./global-setup";

// ADM-12/13 in a browser. The service rules — the approval batch, the conflict cases, the whole
// transition matrix — are pinned in tests/unit/applications.test.ts. What only a browser shows is
// that the review panel hydrates and that the buttons it offers match what the API accepts.
test.describe("application review", () => {
  test("the listing links through to the detail screen", async ({ page }) => {
    await page.goto("/applications");
    await expect(page.getByRole("link", { name: "E2E 商店" }).first()).toBeVisible();
  });

  test("the review panel hydrates and offers only the legal moves", async ({ page }) => {
    await page.goto(`/applications/${E2E_APPLICATIONS.received}`);

    // received: reviewing is the only move an operator has; withdrawn belongs to the applicant.
    const start = page.getByRole("button", { name: "審査を開始する" });
    // Disabled until hydration would mean not enabled — this is the check that catches a missing
    // client:* directive (DEV-03 §3-5).
    await expect(start).toBeEnabled();
    await expect(page.getByRole("button", { name: "承認する" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "否認する" })).toHaveCount(0);
  });

  test("a reviewing application offers approve and reject", async ({ page }) => {
    await page.goto(`/applications/${E2E_APPLICATIONS.reviewing}`);

    await expect(page.getByRole("button", { name: "承認する" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "否認する" })).toBeEnabled();
  });

  test("approving creates the organization and its first member", async ({ page, request, baseURL }) => {
    // The dev server compiles the approve route on first hit (around 6s cold), then the batch runs.
    test.setTimeout(90_000);
    const orgCode = `ORG-E2E${Date.now() % 100000}`;

    await page.goto(`/applications/${E2E_APPLICATIONS.toApprove}`);
    await page.getByRole("button", { name: "承認する" }).click();
    await page.getByLabel("取引先コード").fill(orgCode);
    await page.getByRole("button", { name: "この内容で承認する" }).click();

    // Verified through the API rather than by waiting on the reloaded page. The panel calls
    // location.reload() on success, and under the Vite dev server that request can arrive while
    // the approval's waitUntil is still in flight — which crashes the worker and returns an empty
    // 200 (00_DEV_GUIDE §6). The built worker handles the same sequence correctly, so the bug is
    // the dev plugin's, not the route's; asserting on the write keeps this test about the write.
    // Failures are swallowed rather than thrown: while the dev worker restarts it answers HTML, and
    // .json() on that would abort the poll instead of letting it wait the restart out.
    const hasOrganization = async () => {
      try {
        const response = await request.get("/api/v1/organizations", { headers: { Origin: baseURL! } });
        if (!response.ok()) return false;
        return ((await response.json()).data as { orgCode: string }[]).some((row) => row.orgCode === orgCode);
      } catch {
        return false;
      }
    };

    await expect.poll(hasOrganization, { timeout: 45_000 }).toBe(true);

    const organizations = await (await request.get("/api/v1/organizations", { headers: { Origin: baseURL! } })).json();
    const created = organizations.data.find((row: { orgCode: string }) => row.orgCode === orgCode);

    // ADM-16 reads the membership the same batch created — the part that would silently go
    // missing if the approval were split into two transactions.
    const members = await (await request.get(`/api/v1/organizations/${created.id}/members`, { headers: { Origin: baseURL! } })).json();
    expect(members.data).toHaveLength(1);
  });

  test("an illegal move answers 409 rather than doing something else", async ({ request, baseURL }) => {
    // received -> needs_confirmation is not in the matrix (DEV-09 §2-1-2).
    //
    // `data` is what makes Playwright send application/json. Without a body the request carries no
    // Content-Type, and Astro's origin check treats that as a cross-site form post and rejects it
    // before the route runs (DEV-01 §2) — the island always sends JSON, so the test must too.
    const response = await request.post(`/api/v1/applications/${E2E_APPLICATIONS.received}/request-confirmation`, { headers: { Origin: baseURL! }, data: {} });

    expect(response.status()).toBe(409);
    expect((await response.json()).error_code).toBe("INVALID_STATE_TRANSITION");
  });

  test("a rejection without a reason answers 422", async ({ request, baseURL }) => {
    const response = await request.post(`/api/v1/applications/${E2E_APPLICATIONS.toReject}/reject`, { headers: { Origin: baseURL! }, data: { reason: "" } });
    expect(response.status()).toBe(422);
  });
});
