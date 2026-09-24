// Login, activation and password reset. Session verification lives in ../auth/session.ts; this
// file is about turning a credential — a password, or a token that arrived by mail — into one.
import { memberPasswordResetTokens, members } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { burnPasswordVerification, hashPassword, newSessionToken, verifyPassword, verifyToken } from "@app/server-kit/auth";
import { UnauthenticatedError } from "@app/server-kit/http";
import { and, eq, isNull } from "drizzle-orm";
import { createSession, destroySession, destroySessionsForMember } from "../auth/session";
import { getMemberByEmail, getMemberByPublicId, touchLastLogin } from "./members";

// DEV-07 §5-3. Short because the mail is sent immediately and acted on immediately; a link that
// outlives the request is a spare key sitting in an inbox.
export const PASSWORD_RESET_TTL_MINUTES = 60;

export async function login(db: DbClient, email: string, password: string, ttlDays: number) {
  const member = await getMemberByEmail(db, email);

  // Same error for "no such account" and "wrong password" — do not let a client distinguish
  // account existence from credential correctness.
  const invalidCredentials = () => new UnauthenticatedError("メールアドレスまたはパスワードが正しくありません。");

  // Burn one derivation on the miss paths too, or they answer far faster than a real account —
  // an enumeration oracle regardless of the message being identical. A null hash is an
  // unactivated or OAuth-only member (D-004) and takes the same path.
  if (!member || member.status !== "active" || member.passwordHash === null) {
    await burnPasswordVerification(password);
    throw invalidCredentials();
  }

  const valid = await verifyPassword(password, member.passwordHash);
  if (!valid) throw invalidCredentials();

  const session = await createSession(db, member.id, ttlDays);
  await touchLastLogin(db, member.id);

  return { session, member };
}

export async function logout(db: DbClient, token: string): Promise<void> {
  await destroySession(db, token);
}

// Setting the first password from the link S4 mailed on approval (F-01-05).
//
// There is no activation table: the signed token is the whole credential, and single use comes
// from `password_hash IS NULL` — once set, the link stops working. That condition is in the
// UPDATE's WHERE clause rather than checked beforehand, so two clicks racing cannot both win.
export async function activateAccount(db: DbClient, secret: string | undefined, token: string, password: string, ttlDays: number) {
  // Every way this can fail answers the same: an unusable link must not reveal whether it was
  // wrong, expired, or already used (DEV-04 §5-3's rule, applied here too).
  const unusable = () => new UnauthenticatedError("この有効化リンクは使用できません。お手数ですが、運営までお問い合わせください。");

  const memberPublicId = await verifyToken(secret, "account-activation", token);
  if (!memberPublicId) throw unusable();

  const member = await getMemberByPublicId(db, memberPublicId);
  if (!member || member.status !== "active") throw unusable();

  const passwordHash = await hashPassword(password);
  const [activated] = await db
    .update(members)
    .set({ passwordHash, updatedAt: new Date().toISOString() })
    .where(and(eq(members.id, member.id), isNull(members.passwordHash)))
    .returning();

  // No row came back: the password was already set between the read and the write, or before it.
  if (!activated) throw unusable();

  const session = await createSession(db, member.id, ttlDays);
  await touchLastLogin(db, member.id);
  return { session, member: activated };
}

export interface PasswordResetRequest {
  token: string;
  member: typeof members.$inferSelect;
}

// Issues a reset token, or nothing at all when the address belongs to no active account. Returns
// null in that case rather than throwing: the route answers the same either way, because a
// different answer turns this endpoint into a membership oracle (DEV-02 §7).
//
// Unlike login there is no password to verify, so there is no derivation to burn — the work either
// path does is one SELECT, and the mail that dominates the cost happens after the response in both
// cases (it is never sent for an unknown address, and nobody outside can observe that).
export async function requestPasswordReset(db: DbClient, email: string): Promise<PasswordResetRequest | null> {
  const member = await getMemberByEmail(db, email);
  if (!member || member.status !== "active") return null;

  // 32 random bytes, looked up by exact match — the row is the verification, so this one is not
  // HMAC-signed the way the tokens with no backing record are (DEV-01 §2).
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000).toISOString();

  await db.insert(memberPasswordResetTokens).values({ memberId: member.id, token, expiresAt });
  return { token, member };
}

// Consumes a reset token. The `used_at` stamp and the new password go in one batch(): if only the
// password landed, the same link could set it again tomorrow.
export async function resetPassword(db: DbClient, token: string, password: string): Promise<void> {
  const unusable = () => new UnauthenticatedError("このリンクは使用できません。お手数ですが、もう一度お手続きください。");

  const [row] = await db.select({ id: memberPasswordResetTokens.id, memberId: memberPasswordResetTokens.memberId, expiresAt: memberPasswordResetTokens.expiresAt, usedAt: memberPasswordResetTokens.usedAt, status: members.status }).from(memberPasswordResetTokens).innerJoin(members, eq(memberPasswordResetTokens.memberId, members.id)).where(eq(memberPasswordResetTokens.token, token)).limit(1);

  if (!row || row.usedAt !== null || row.expiresAt <= new Date().toISOString() || row.status !== "active") throw unusable();

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  await db.batch([
    // `used_at IS NULL` in the WHERE clause, not just in the read above: two clicks arriving
    // together would otherwise both pass the check and both reset the password.
    db
      .update(memberPasswordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(memberPasswordResetTokens.id, row.id), isNull(memberPasswordResetTokens.usedAt))),
    db.update(members).set({ passwordHash, updatedAt: now }).where(eq(members.id, row.memberId)),
  ]);

  // Whoever was logged in with the old password is logged out. A reset is most often a response to
  // a suspected compromise, and leaving the intruder's session alive defeats it (DEV-09 §2-4-4).
  await destroySessionsForMember(db, row.memberId);
}
