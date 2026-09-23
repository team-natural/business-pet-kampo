import { expect, test } from "@playwright/test";

// The routes Cloudflare Access is configured to bypass (DEV-08 §9). Playwright cannot reproduce a
// real bypass — wrangler.jsonc's access.dev block supplies a pseudo identity to every local
// request — so what this proves is that the routes exist and answer. That the middleware lets them
// through *without* an identity, and refuses everything else, is pinned in tests/unit/health.test.ts.
test.describe("health checks", () => {
  for (const path of ["/api/v1/health", "/api/v1/health/db"]) {
    test(`${path} answers 200, uncacheably`, async ({ request }) => {
      const response = await request.get(path);

      expect(response.status()).toBe(200);
      expect((await response.json()).status).toBe("ok");
      expect(response.headers()["cache-control"]).toContain("no-store");
    });
  }

  // apps/admin has no KV binding (D-022), so this route must not exist here.
  test("there is no KV probe on the admin app", async ({ request }) => {
    expect((await request.get("/api/v1/health/kv")).status()).toBe(404);
  });
});
