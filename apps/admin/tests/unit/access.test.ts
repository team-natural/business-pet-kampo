// Covers what E2E cannot: the fail-closed half of Cloudflare Access (D-022). Playwright runs
// against the dev fallback, so only these assertions ever exercise a real token — or prove the
// fallback is dead in production.
import { env } from "cloudflare:workers";
import { adminUsers } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ForbiddenError, UnauthenticatedError } from "@app/server-kit/http";
import { ulid } from "@app/schema/ulid";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readAccessConfig, requireAdminUser, resolveAccessEmail, verifyAccessJwt } from "../../src/lib/server/auth/access";

const db = createDb(env.DB);
const TEAM_DOMAIN = "example.cloudflareaccess.com";
const ISSUER = `https://${TEAM_DOMAIN}`;
const AUD = "test-aud-tag";

const baseEnv = { APP_ENV: "development", ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD, DEV_ADMIN_EMAIL: "dev-admin@example.test" };

const encode = (value: object) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

let keyPair: CryptoKeyPair;
let kid: string;

// A real RS256 token, so the signature path is exercised rather than mocked past.
async function signJwt(payload: Record<string, unknown>, options: { alg?: string; kid?: string } = {}) {
  const header = encode({ alg: options.alg ?? "RS256", kid: options.kid ?? kid });
  const body = encode(payload);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(`${header}.${body}`));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `${header}.${body}.${encoded}`;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return { aud: [AUD], iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 600, email: "operator@example.com", ...overrides };
}

// One key pair for the file: access.ts caches the team's JWKS in module scope, so rotating the
// key per test would leave later tests verifying against the first test's cached key.
beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  kid = ulid();
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== `${ISSUER}/cdn-cgi/access/certs`) throw new Error(`Unexpected fetch: ${String(input)}`);
      return Response.json({ keys: [{ ...jwk, kid }] });
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  await db.delete(adminUsers);
});

describe("readAccessConfig", () => {
  it("throws on missing config instead of verifying against nothing", () => {
    expect(() => readAccessConfig({ ...baseEnv, APP_ENV: undefined })).toThrow();
    expect(() => readAccessConfig({ ...baseEnv, ACCESS_TEAM_DOMAIN: undefined })).toThrow();
    expect(() => readAccessConfig({ ...baseEnv, ACCESS_AUD: undefined })).toThrow();
  });

  it("drops the dev fallback in production", () => {
    expect(readAccessConfig(baseEnv).devAdminEmail).toBe("dev-admin@example.test");
    expect(readAccessConfig({ ...baseEnv, APP_ENV: "production" }).devAdminEmail).toBeNull();
  });
});

describe("resolveAccessEmail", () => {
  it("falls back to DEV_ADMIN_EMAIL only outside production", async () => {
    const request = new Request("https://admin.example.com/");

    await expect(resolveAccessEmail(request, baseEnv)).resolves.toBe("dev-admin@example.test");
    // The whole point of the fail-closed rule: a header-less request in production is anonymous,
    // whatever DEV_ADMIN_EMAIL happens to hold.
    await expect(resolveAccessEmail(request, { ...baseEnv, APP_ENV: "production" })).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("verifies a token that is present even when the fallback is available", async () => {
    const token = await signJwt(validPayload());
    const request = new Request("https://admin.example.com/", { headers: { "cf-access-jwt-assertion": token } });

    await expect(resolveAccessEmail(request, baseEnv)).resolves.toBe("operator@example.com");
  });
});

describe("verifyAccessJwt", () => {
  const config = () => readAccessConfig({ ...baseEnv, APP_ENV: "production" });

  it("accepts a token signed by the team key for this application", async () => {
    await expect(verifyAccessJwt(await signJwt(validPayload()), config())).resolves.toBe("operator@example.com");
  });

  it("rejects another application's audience", async () => {
    await expect(verifyAccessJwt(await signJwt(validPayload({ aud: ["someone-elses-aud"] })), config())).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects another team's issuer", async () => {
    await expect(verifyAccessJwt(await signJwt(validPayload({ iss: "https://attacker.cloudflareaccess.com" })), config())).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects an expired token", async () => {
    await expect(verifyAccessJwt(await signJwt(validPayload({ exp: Math.floor(Date.now() / 1000) - 1 })), config())).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects an unsigned token and an unknown signing key", async () => {
    const [header, payload] = (await signJwt(validPayload())).split(".");
    await expect(verifyAccessJwt(`${header}.${payload}.`, config())).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(verifyAccessJwt(await signJwt(validPayload(), { kid: ulid() }), config())).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects a token whose header asks for a different algorithm", async () => {
    // alg is pinned, so a "none"/HS256 token cannot talk the verifier out of checking RSA.
    await expect(verifyAccessJwt(await signJwt(validPayload(), { alg: "none" }), config())).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("requireAdminUser", () => {
  const contextFor = (accessEmail: string | null) => ({ locals: { accessEmail, db } }) as Parameters<typeof requireAdminUser>[0];

  it("provisions the ledger row on first arrival", async () => {
    const user = await requireAdminUser(contextFor("new-operator@example.com"));

    expect(user.email).toBe("new-operator@example.com");
    expect(user.status).toBe("active");
    expect(await db.select().from(adminUsers)).toHaveLength(1);

    // A second request reuses the row rather than racing the unique index.
    await requireAdminUser(contextFor("new-operator@example.com"));
    expect(await db.select().from(adminUsers)).toHaveLength(1);
  });

  it("refuses an inactive ledger row even with a verified identity", async () => {
    const user = await requireAdminUser(contextFor("leaver@example.com"));
    await db.update(adminUsers).set({ status: "inactive" }).where(eq(adminUsers.id, user.id));

    await expect(requireAdminUser(contextFor("leaver@example.com"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses when middleware put no identity on locals", async () => {
    await expect(requireAdminUser(contextFor(null))).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
