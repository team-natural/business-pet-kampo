import { expect, test } from "@playwright/test";

// The endpoints an external monitor polls (DEV-08 §9). They must answer without a session, and
// they must not be cacheable — a cached 200 keeps reporting health after the Worker stops serving.
test.describe("health checks", () => {
  for (const path of ["/api/v1/health", "/api/v1/health/db", "/api/v1/health/kv"]) {
    test(`${path} answers 200 to an unauthenticated monitor, uncacheably`, async ({ request }) => {
      const response = await request.get(path);

      expect(response.status()).toBe(200);
      expect((await response.json()).status).toBe("ok");
      expect(response.headers()["cache-control"]).toContain("no-store");
    });
  }

  test("the liveness probe reports nothing about the app", async ({ request }) => {
    // Unauthenticated, so the body is a fact about availability and nothing else.
    const body = await (await request.get("/api/v1/health")).json();
    expect(Object.keys(body)).toEqual(["status"]);
  });
});
