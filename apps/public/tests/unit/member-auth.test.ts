// Activation, password reset and the email change (FG-01). Most of this file is about the rules
// that have no visible effect when they are broken: single use, session revocation, and answering
// the same way whether or not an account exists (DEV-02 §7).
import { env } from "cloudflare:workers";
import { memberPasswordResetTokens, memberSessions, members, memberships, organizations } from "@app/schema";
import { createDb } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { hashPassword, signToken, verifyPassword } from "@app/server-kit/auth";
import { ConflictError, UnauthenticatedError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { activateAccount, login, requestPasswordReset, resetPassword } from "../../src/lib/server/services/auth";
import { confirmEmailChange, requestEmailChange, updateProfile } from "../../src/lib/server/services/members";

const db = createDb(env.DB);
const SECRET = "test-signing-key";
const TTL_DAYS = 30;
const PASSWORD = "correct-horse-battery";

async function seedMember(overrides: Partial<typeof members.$inferInsert> = {}) {
  const [row] = await db
    .insert(members)
    .values({ publicId: ulid(), name: "佐藤 花子", email: `${ulid()}@example.test`, passwordHash: null, status: "active", updatedAt: new Date().toISOString(), ...overrides })
    .returning();
  return row!;
}

const activationToken = (publicId: string) => signToken(SECRET, "account-activation", publicId, 3600);

beforeEach(async () => {
  await db.delete(memberPasswordResetTokens);
  await db.delete(memberSessions);
  await db.delete(memberships);
  await db.delete(members);
  await db.delete(organizations);
});

describe("activateAccount", () => {
  it("sets the first password and signs the member in", async () => {
    const member = await seedMember();
    const { session, member: activated } = await activateAccount(db, SECRET, await activationToken(member.publicId), PASSWORD, TTL_DAYS);

    expect(session.token).toBeTruthy();
    expect(await verifyPassword(PASSWORD, activated.passwordHash!)).toBe(true);
  });

  // There is no activation table, so `password_hash IS NULL` is the whole of single use.
  it("refuses a second use of the same link", async () => {
    const member = await seedMember();
    const token = await activationToken(member.publicId);

    await activateAccount(db, SECRET, token, PASSWORD, TTL_DAYS);
    await expect(activateAccount(db, SECRET, token, "a-different-password", TTL_DAYS)).rejects.toBeInstanceOf(UnauthenticatedError);

    // The first password survives; the replay did not overwrite it.
    const [row] = await db.select().from(members).where(eq(members.id, member.id));
    expect(await verifyPassword(PASSWORD, row!.passwordHash!)).toBe(true);
  });

  it("refuses a forged token, a wrong-purpose token and an unknown member alike", async () => {
    const member = await seedMember();

    for (const token of [await signToken("another-key", "account-activation", member.publicId, 3600), await signToken(SECRET, "password-reset", member.publicId, 3600), await activationToken(ulid()), "not-a-token"]) {
      await expect(activateAccount(db, SECRET, token, PASSWORD, TTL_DAYS)).rejects.toBeInstanceOf(UnauthenticatedError);
    }
  });

  it("refuses a deactivated member", async () => {
    const member = await seedMember({ status: "deactivated" });
    await expect(activateAccount(db, SECRET, await activationToken(member.publicId), PASSWORD, TTL_DAYS)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("requestPasswordReset", () => {
  it("issues a token for an active member", async () => {
    const member = await seedMember({ passwordHash: await hashPassword(PASSWORD) });
    const issued = await requestPasswordReset(db, member.email);

    expect(issued?.token).toBeTruthy();
    const [row] = await db.select().from(memberPasswordResetTokens);
    expect(row).toMatchObject({ memberId: member.id, usedAt: null });
  });

  // Returns null rather than throwing, so the route can answer 204 either way (DEV-02 §7).
  it("returns null for an unknown address without storing anything", async () => {
    await expect(requestPasswordReset(db, "nobody@example.test")).resolves.toBeNull();
    expect(await db.select().from(memberPasswordResetTokens)).toHaveLength(0);
  });

  it("returns null for a deactivated member", async () => {
    const member = await seedMember({ status: "deactivated" });
    await expect(requestPasswordReset(db, member.email)).resolves.toBeNull();
  });
});

describe("resetPassword", () => {
  async function issue() {
    const member = await seedMember({ passwordHash: await hashPassword("old-password-here") });
    const issued = await requestPasswordReset(db, member.email);
    return { member, token: issued!.token };
  }

  it("sets the new password and stamps the token used", async () => {
    const { member, token } = await issue();
    await resetPassword(db, token, PASSWORD);

    const [row] = await db.select().from(members).where(eq(members.id, member.id));
    expect(await verifyPassword(PASSWORD, row!.passwordHash!)).toBe(true);

    const [used] = await db.select().from(memberPasswordResetTokens);
    expect(used!.usedAt).not.toBeNull();
  });

  // The stamp and the password go in one batch. If only the password landed, the same link would
  // still work tomorrow.
  it("refuses a second use of the same token", async () => {
    const { token } = await issue();
    await resetPassword(db, token, PASSWORD);

    await expect(resetPassword(db, token, "yet-another-password")).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  // A reset is what someone does when they suspect a compromise; leaving the intruder signed in
  // defeats the point (DEV-09 §2-4-4).
  it("drops every existing session", async () => {
    const { member, token } = await issue();
    await login(db, member.email, "old-password-here", TTL_DAYS);
    expect(await db.select().from(memberSessions)).toHaveLength(1);

    await resetPassword(db, token, PASSWORD);
    expect(await db.select().from(memberSessions)).toHaveLength(0);
  });

  it("refuses an expired token", async () => {
    const { member } = await issue();
    await db
      .update(memberPasswordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(memberPasswordResetTokens.memberId, member.id));

    const [row] = await db.select().from(memberPasswordResetTokens);
    await expect(resetPassword(db, row!.token, PASSWORD)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("refuses an unknown token", async () => {
    await expect(resetPassword(db, "not-a-real-token", PASSWORD)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("lets the member log in with the new password afterwards", async () => {
    const { member, token } = await issue();
    await resetPassword(db, token, PASSWORD);

    await expect(login(db, member.email, PASSWORD, TTL_DAYS)).resolves.toMatchObject({ member: { id: member.id } });
    await expect(login(db, member.email, "old-password-here", TTL_DAYS)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("profile and email change", () => {
  it("updates the name and phone immediately", async () => {
    const member = await seedMember();
    const updated = await updateProfile(db, member.id, { name: "新しい名前", email: member.email, phone: "0312345678" });

    expect(updated).toMatchObject({ name: "新しい名前", phone: "0312345678" });
  });

  // The address must not move until the new one has answered its own link.
  it("does not change the address through updateProfile", async () => {
    const member = await seedMember();
    await updateProfile(db, member.id, { name: member.name, email: "new@example.test" });

    const [row] = await db.select().from(members).where(eq(members.id, member.id));
    expect(row!.email).toBe(member.email);
  });

  it("applies the address only once the token is confirmed", async () => {
    const member = await seedMember();
    const token = await requestEmailChange(db, SECRET, member, "new@example.test");

    const confirmed = await confirmEmailChange(db, SECRET, token);
    expect(confirmed.email).toBe("new@example.test");
  });

  it("refuses an address that already belongs to someone", async () => {
    const taken = await seedMember({ email: "taken@example.test" });
    const member = await seedMember();

    await expect(requestEmailChange(db, SECRET, member, taken.email)).rejects.toBeInstanceOf(ConflictError);
  });

  // Claimed between the request and the click.
  it("refuses at confirmation time if the address was taken meanwhile", async () => {
    const member = await seedMember();
    const token = await requestEmailChange(db, SECRET, member, "race@example.test");
    await seedMember({ email: "race@example.test" });

    await expect(confirmEmailChange(db, SECRET, token)).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses a token signed for another purpose", async () => {
    const member = await seedMember();
    const token = await signToken(SECRET, "account-activation", `${member.publicId}:new@example.test`, 3600);

    await expect(confirmEmailChange(db, SECRET, token)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
