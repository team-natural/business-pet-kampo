// Covers what E2E cannot: the fail-closed half of Cloudflare Access (D-022, D-029). Local dev and
// Playwright run on the ctx.access path, so only these assertions ever exercise the JWT path that
// production actually uses — or prove that a request without either is refused.
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

const baseEnv = { CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUD };

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

// What middleware.ts passes in: a request plus whatever the adapter put on locals.
function contextWith(options: { token?: string; identityEmail?: string | null; access?: boolean } = {}) {
  const headers = options.token ? { "cf-access-jwt-assertion": options.token } : undefined;
  const access = options.access ? { aud: AUD, getIdentity: async () => (options.identityEmail === null ? undefined : { email: options.identityEmail }) } : undefined;

  return {
    request: new Request("https://admin.example.com/", { headers }),
    locals: { cfContext: access ? { access } : undefined },
  } as unknown as Parameters<typeof resolveAccessEmail>[0];
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
    expect(() => readAccessConfig({ ...baseEnv, CF_ACCESS_TEAM_DOMAIN: undefined })).toThrow();
    expect(() => readAccessConfig({ ...baseEnv, CF_ACCESS_AUD: undefined })).toThrow();
  });
});

describe("resolveAccessEmail", () => {
  it("prefers ctx.access, which needs no token and no team config", async () => {
    // The path wrangler's `access.dev` block drives locally, and the one Cloudflare recommends
    // wherever the Worker actually receives it.
    await expect(resolveAccessEmail(contextWith({ access: true, identityEmail: "operator@example.com" }), {})).resolves.toBe("operator@example.com");
  });

  it("refuses an Access context that carries no email", async () => {
    // A service token authenticates but names no person, and an audit entry needs someone to
    // attribute the action to.
    await expect(resolveAccessEmail(contextWith({ access: true, identityEmail: null }), baseEnv)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("falls back to the verified JWT header when ctx.access is absent", async () => {
    // Production runs here: a Worker serving static assets sits behind a router that does not
    // pass ctx.access through (D-029).
    const token = await signJwt(validPayload());
    await expect(resolveAccessEmail(contextWith({ token }), baseEnv)).resolves.toBe("operator@example.com");
  });

  it("refuses a request with neither an Access context nor a token", async () => {
    await expect(resolveAccessEmail(contextWith(), baseEnv)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("verifyAccessJwt", () => {
  const config = () => readAccessConfig(baseEnv);

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
