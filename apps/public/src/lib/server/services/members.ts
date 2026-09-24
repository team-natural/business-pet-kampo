// Read paths and self-service edits for the logged-in member. Account creation is not here:
// members exist only because an application was approved (DEV-10 §5-3, PRD-03 F-02-06).
import { members } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { signToken, verifyToken } from "@app/server-kit/auth";
import { ConflictError, NotFoundError, UnauthenticatedError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";
import type { UpdateMemberInput } from "../validation/me";

type MemberRow = typeof members.$inferSelect;

// Long enough to find the mail, short enough that an address typed by mistake stops being
// claimable by the end of the day.
export const EMAIL_CHANGE_TTL_SECONDS = 60 * 60 * 24;

// Never let `passwordHash` (or the internal integer `id`) leave this layer in a response body.
export function toPublicMember(member: MemberRow) {
  return {
    id: member.publicId,
    name: member.name,
    email: member.email,
    phone: member.phone,
    status: member.status,
  };
}

export async function getMemberByEmail(db: DbClient, email: string) {
  const [row] = await db.select().from(members).where(eq(members.email, email)).limit(1);
  return row ?? null;
}

export async function getMemberByPublicId(db: DbClient, publicId: string) {
  const [row] = await db.select().from(members).where(eq(members.publicId, publicId)).limit(1);
  return row ?? null;
}

export async function touchLastLogin(db: DbClient, memberId: number): Promise<void> {
  await db.update(members).set({ lastLoginAt: new Date().toISOString() }).where(eq(members.id, memberId));
}

// Name and phone apply immediately. The address does not — see requestEmailChange.
export async function updateProfile(db: DbClient, memberId: number, input: UpdateMemberInput) {
  const [updated] = await db
    .update(members)
    .set({ name: input.name, phone: input.phone ?? null, updatedAt: new Date().toISOString() })
    .where(eq(members.id, memberId))
    .returning();

  if (!updated) throw new NotFoundError("アカウントが見つかりません。");
  return toPublicMember(updated);
}

// The new address has to be proven before it replaces the old one: an unconfirmed change would
// redirect every future notice — including password resets — to whoever typed it.
//
// The pending address rides inside the signed token rather than in a column. There is no
// `pending_email` in DEV-07, and the HMAC already makes the payload unforgeable, so a table would
// only add a row to expire.
export async function requestEmailChange(db: DbClient, secret: string | undefined, member: MemberRow, newEmail: string): Promise<string> {
  if (newEmail === member.email) throw new ConflictError("現在のメールアドレスと同じです。");

  // members.email is unique, so a duplicate would fail the confirmation's UPDATE instead. Told
  // here because the member can act on it — and it reveals nothing they could not learn by
  // trying to apply with that address anyway.
  if (await getMemberByEmail(db, newEmail)) throw new ConflictError("このメールアドレスは既に使われています。");

  return signToken(secret, "email-change", `${member.publicId}:${newEmail}`, EMAIL_CHANGE_TTL_SECONDS);
}

// Applies a confirmed address change. Every failure answers alike: the link arrives by mail and
// its holder is not yet proven to be the account's owner.
export async function confirmEmailChange(db: DbClient, secret: string | undefined, token: string) {
  const unusable = () => new UnauthenticatedError("このリンクは使用できません。お手数ですが、もう一度お手続きください。");

  const subject = await verifyToken(secret, "email-change", token);
  if (!subject) throw unusable();

  // Split on the first colon only: an address cannot contain one before the @, but the publicId
  // never does, so the boundary is unambiguous from the left.
  const separator = subject.indexOf(":");
  if (separator === -1) throw unusable();

  const memberPublicId = subject.slice(0, separator);
  const newEmail = subject.slice(separator + 1);

  const member = await getMemberByPublicId(db, memberPublicId);
  if (!member || member.status !== "active") throw unusable();
  // Claimed by someone else between the request and the click.
  if (await getMemberByEmail(db, newEmail)) throw new ConflictError("このメールアドレスは既に使われています。");

  const [updated] = await db.update(members).set({ email: newEmail, updatedAt: new Date().toISOString() }).where(eq(members.id, member.id)).returning();
  return toPublicMember(updated!);
}
