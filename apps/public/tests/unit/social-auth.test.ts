// FG-01's social half (DEV-10 §5). The rule worth a test above all others is a negative one:
// authenticating with a provider must never create a Member. E2E cannot reach any of this without
// a real provider registration, so everything below lives here.
import { env } from "cloudflare:workers";
import { memberSessions, members, socialAccounts } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { signToken } from "@app/server-kit/auth";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { configuredProviders, createAuthorizationRequest, isOAuthProvider, type OAuthEnv } from "../../src/lib/server/auth/oauth";
import { completeSocialLink, loginWithSocialIdentity, signLinkIntent } from "../../src/lib/server/services/social-auth";

const db = createDb(env.DB);
const SECRET = "test-signing-key";
const TTL_DAYS = 30;

const identity = (overrides: Partial<{ providerUserId: string; email: string | null; name: string | null }> = {}) => ({
  providerUserId: "provider-subject-1",
  email: "sato@example.test",
  name: "佐藤 花子",
  ...overrides,
});

async function seedMember(overrides: Partial<typeof members.$inferInsert> = {}) {
  const [row] = await db
    .insert(members)
    .values({ publicId: ulid(), name: "佐藤 花子", email: "sato@example.test", passwordHash: null, status: "active", updatedAt: new Date().toISOString(), ...overrides })
    .returning();
  return row!;
}

const memberCount = async () => (await db.select().from(members)).length;

beforeEach(async () => {
  await db.delete(socialAccounts);
  await db.delete(memberSessions);
  await db.delete(members);
});

describe("provider configuration", () => {
  const fullEnv: OAuthEnv = {
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_REDIRECT_URI: "https://example.test/auth/google/callback",
    FACEBOOK_CLIENT_ID: "id",
    FACEBOOK_CLIENT_SECRET: "secret",
    FACEBOOK_REDIRECT_URI: "https://example.test/auth/facebook/callback",
  };

  it("counts only providers with all three values set", () => {
    expect(configuredProviders(fullEnv).sort()).toEqual(["facebook", "google"]);
    expect(configuredProviders({ ...fullEnv, GOOGLE_CLIENT_SECRET: "" })).toEqual(["facebook"]);
    expect(configuredProviders({})).toEqual([]);
  });

  // Switched off rather than fail-closed-with-a-throw: an absent client id can only stop a login,
  // never weaken one, and the three registrations have their own lead time (D-036).
  it("returns null for an unconfigured provider instead of throwing", () => {
    expect(createAuthorizationRequest({}, "google")).toBeNull();
  });

  it("builds a PKCE authorization URL for Google and a plain one for Facebook", () => {
    const google = createAuthorizationRequest(fullEnv, "google")!;
    expect(google.url).toContain("accounts.google.com");
    expect(google.url).toContain(encodeURIComponent(google.state));
    expect(google.codeVerifier).not.toBe("");
    expect(google.url).toContain("code_challenge");

    // Facebook's flow carries no verifier; sending one would be a parameter the provider ignores
    // and a cookie the callback would wrongly require.
    const facebook = createAuthorizationRequest(fullEnv, "facebook")!;
    expect(facebook.codeVerifier).toBe("");
  });

  it("rejects anything outside the allow-list", () => {
    expect(isOAuthProvider("google")).toBe(true);
    expect(isOAuthProvider("github")).toBe(false);
    expect(isOAuthProvider(undefined)).toBe(false);
  });
});

describe("loginWithSocialIdentity", () => {
  // The whole point of the stage. A findOrCreate here would hand a session to anyone with a Google
  // account and take the screening requirement out of the product (DEV-10 §5-3, INTAKE §7).
  it("creates no Member for an address that has never applied", async () => {
    const before = await memberCount();

    const result = await loginWithSocialIdentity(db, "google", identity({ email: "stranger@example.test" }), TTL_DAYS);

    expect(result.outcome).toBe("not-registered");
    expect(await memberCount()).toBe(before);
    expect(await db.select().from(socialAccounts)).toHaveLength(0);
    expect(await db.select().from(memberSessions)).toHaveLength(0);
  });

  it("signs in a linked, active member", async () => {
    const member = await seedMember();
    await db.insert(socialAccounts).values({ memberId: member.id, provider: "google", providerUserId: "provider-subject-1", updatedAt: new Date().toISOString() });

    const result = await loginWithSocialIdentity(db, "google", identity(), TTL_DAYS);

    expect(result.outcome).toBe("signed-in");
    expect(await db.select().from(memberSessions)).toHaveLength(1);
  });

  it("refuses a linked member whose account is not active", async () => {
    const member = await seedMember({ status: "suspended" });
    await db.insert(socialAccounts).values({ memberId: member.id, provider: "google", providerUserId: "provider-subject-1", updatedAt: new Date().toISOString() });

    const result = await loginWithSocialIdentity(db, "google", identity(), TTL_DAYS);

    expect(result.outcome).toBe("inactive");
    expect(await db.select().from(memberSessions)).toHaveLength(0);
  });

  // Anyone can create a provider account claiming any address, so a matching email is a prompt for
  // the password, never a login on its own (DEV-10 §5-3).
  it("offers a link rather than signing in when only the address matches", async () => {
    await seedMember();

    const result = await loginWithSocialIdentity(db, "google", identity(), TTL_DAYS);

    expect(result).toEqual({ outcome: "link-required", email: "sato@example.test" });
    expect(await db.select().from(memberSessions)).toHaveLength(0);
    expect(await db.select().from(socialAccounts)).toHaveLength(0);
  });

  // A LINE account that withheld the email scope: there is nothing to match a Member on.
  it("treats an identity with no address as unregistered", async () => {
    await seedMember();

    const result = await loginWithSocialIdentity(db, "line", identity({ email: null }), TTL_DAYS);
    expect(result.outcome).toBe("not-registered");
  });

  it("matches a provider's address case-insensitively only as the provider normalised it", async () => {
    await seedMember({ email: "sato@example.test" });

    // oauth.ts lowercases what the provider returns, so this is the shape the service ever sees.
    const result = await loginWithSocialIdentity(db, "google", identity({ email: "sato@example.test" }), TTL_DAYS);
    expect(result.outcome).toBe("link-required");
  });
});

describe("completeSocialLink", () => {
  it("links after the password proved the address", async () => {
    const member = await seedMember();
    const token = await signLinkIntent(SECRET, "google", { ...identity(), email: "sato@example.test" });

    expect(await completeSocialLink(db, SECRET, token, member)).toBe("google");

    const [row] = await db.select().from(socialAccounts).where(eq(socialAccounts.memberId, member.id));
    expect(row!.provider).toBe("google");
    expect(row!.providerUserId).toBe("provider-subject-1");
  });

  // Without this check a stolen intent cookie would attach the attacker's provider account to
  // whoever logs in next.
  it("refuses an intent for a different address", async () => {
    const member = await seedMember({ email: "someone-else@example.test" });
    const token = await signLinkIntent(SECRET, "google", { ...identity(), email: "sato@example.test" });

    expect(await completeSocialLink(db, SECRET, token, member)).toBeNull();
    expect(await db.select().from(socialAccounts)).toHaveLength(0);
  });

  it("refuses a token signed for another purpose", async () => {
    const member = await seedMember();
    const token = await signToken(SECRET, "password-reset", `google|provider-subject-1|${member.email}`, 600);

    expect(await completeSocialLink(db, SECRET, token, member)).toBeNull();
  });

  it("refuses a forged or expired token without throwing", async () => {
    const member = await seedMember();

    expect(await completeSocialLink(db, SECRET, "not-a-token", member)).toBeNull();
    expect(await completeSocialLink(db, SECRET, await signToken(SECRET, "social-link", `google|x|${member.email}`, -1), member)).toBeNull();
  });

  it("does not steal a provider account already linked elsewhere", async () => {
    const owner = await seedMember({ email: "owner@example.test" });
    await db.insert(socialAccounts).values({ memberId: owner.id, provider: "google", providerUserId: "provider-subject-1", updatedAt: new Date().toISOString() });

    const member = await seedMember();
    const token = await signLinkIntent(SECRET, "google", { ...identity(), email: "sato@example.test" });

    expect(await completeSocialLink(db, SECRET, token, member)).toBeNull();
    const rows = await db.select().from(socialAccounts);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.memberId).toBe(owner.id);
  });
});
