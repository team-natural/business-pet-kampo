// The health routes are the only paths in this app that answer without an Access identity
// (DEV-08 §9). Two things have to hold at once, and they pull in opposite directions: the monitor
// must get through, and nothing else must.
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { describe, expect, it } from "vitest";
import { onRequest } from "../../src/middleware";
import { checkDatabase } from "../../src/lib/server/services/health";

const db = createDb(env.DB);

// The middleware is the unit here, not the route: it is what would refuse the request, and it
// runs before any route does.
async function runMiddleware(pathname: string): Promise<Response> {
  const context = {
    url: new URL(`https://admin.example.test${pathname}`),
    request: new Request(`https://admin.example.test${pathname}`),
    locals: {} as Record<string, unknown>,
  };
  // No Cf-Access-Jwt-Assertion header and no ctx.access: exactly what an Access bypass delivers.
  const response = await onRequest(context as never, async () => new Response("routed", { status: 200 }));
  // The handler always answers with a Response; the union comes from Astro's signature.
  if (!(response instanceof Response)) throw new Error("middleware returned no response");
  return response;
}

describe("health route access", () => {
  it.each(["/api/v1/health", "/api/v1/health/db"])("lets %s through with no Access identity", async (path) => {
    const response = await runMiddleware(path);
    expect(response.status).toBe(200);
  });

  it("still refuses every other route without an identity", async () => {
    for (const path of ["/", "/orders", "/api/v1/dashboard", "/api/v1/inquiries"]) {
      expect((await runMiddleware(path)).status, path).toBe(403);
    }
  });

  // The bypass list is matched exactly. A prefix match would hand an attacker every route whose
  // path merely starts with the health prefix.
  it.each(["/api/v1/health-check/orders", "/api/v1/healthz", "/api/v1/health/db/../dashboard", "/api/v1/health/kv"])("refuses %s, which only looks like a health path", async (path) => {
    expect((await runMiddleware(path)).status).toBe(403);
  });

  it("keeps the security headers on the bypassed response", async () => {
    const response = await runMiddleware("/api/v1/health");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("gives the bypassed route a db handle, since /health/db needs one", async () => {
    const context = { url: new URL("https://admin.example.test/api/v1/health/db"), request: new Request("https://admin.example.test/api/v1/health/db"), locals: {} as Record<string, unknown> };
    await onRequest(context as never, async () => new Response(null, { status: 200 }));

    expect(context.locals.db).toBeDefined();
    expect(context.locals.accessEmail).toBeNull();
  });
});

describe("checkDatabase", () => {
  it("reports ok against a reachable database", async () => {
    await expect(checkDatabase(db)).resolves.toBe(true);
  });

  it("reports failure rather than throwing, so the route can answer 503", async () => {
    const broken = { run: () => Promise.reject(new Error("D1_ERROR: no such table")) } as never;
    await expect(checkDatabase(broken)).resolves.toBe(false);
  });
});
