// Liveness probes (DEV-08 §9). Both checks report a boolean instead of throwing, which is what
// lets the routes answer 503 rather than 500 — the Worker is fine, its dependency is not.
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { describe, expect, it } from "vitest";
import { checkDatabase, checkKv } from "../../src/lib/server/services/health";

const db = createDb(env.DB);

describe("checkDatabase", () => {
  it("reports ok against a reachable database", async () => {
    await expect(checkDatabase(db)).resolves.toBe(true);
  });

  it("reports failure rather than throwing", async () => {
    const broken = { run: () => Promise.reject(new Error("D1_ERROR: connection lost")) } as never;
    await expect(checkDatabase(broken)).resolves.toBe(false);
  });
});

describe("checkKv", () => {
  it("reports ok against a reachable namespace", async () => {
    await expect(checkKv(env.KV)).resolves.toBe(true);
  });

  it("reports failure rather than throwing", async () => {
    const broken = { get: () => Promise.reject(new Error("KV unavailable")) } as never;
    await expect(checkKv(broken)).resolves.toBe(false);
  });
});
