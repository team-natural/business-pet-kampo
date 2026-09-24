// Social login (FG-01, DEV-10 §5). The rule this file exists to hold: **authenticating with a
// provider never creates a Member.** Members come from an approved application and nowhere else
// (DEV-09 §2-1-4). A `findOrCreate` here would hand a session to anyone with a Google account and
// take the screening requirement out of the product (DEV-10 §5-3, INTAKE §7).
import { members, socialAccounts } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { signToken, verifyToken } from "@app/server-kit/auth";
import { and, eq } from "drizzle-orm";
import type { OAuthProvider, SocialIdentity } from "../auth/oauth";
import { createSession } from "../auth/session";
import { getMemberByEmail, touchLastLogin } from "./members";

type MemberRow = typeof members.$inferSelect;

// Long enough to type a password, short enough that an abandoned link intent does not sit in a
// browser for a day.
export const SOCIAL_LINK_TTL_SECONDS = 15 * 60;

export type SocialLoginResult =
  | { outcome: "signed-in"; session: { token: string; expiresAt: string }; member: MemberRow }
  // The account exists but cannot sign in. Deliberately not distinguished from a wrong password
  // downstream (DEV-02 §1-3).
  | { outcome: "inactive" }
  // A Member with this address exists but has never linked this provider. Linking is offered, not
  // performed: anyone can create a provider account claiming any address, so the password is what
  // proves the two are the same person (DEV-10 §5-3).
  | { outcome: "link-required"; email: string }
  | { outcome: "not-registered" };

export async function loginWithSocialIdentity(db: DbClient, provider: OAuthProvider, identity: SocialIdentity, ttlDays: number): Promise<SocialLoginResult> {
  const [linked] = await db
    .select()
    .from(members)
    .innerJoin(socialAccounts, eq(socialAccounts.memberId, members.id))
    .where(and(eq(socialAccounts.provider, provider), eq(socialAccounts.providerUserId, identity.providerUserId)))
    .limit(1);

  if (linked) {
    const member = linked.members;
    if (member.status !== "active") return { outcome: "inactive" };

    const session = await createSession(db, member.id, ttlDays);
    await touchLastLogin(db, member.id);
    return { outcome: "signed-in", session, member };
  }

  // No address means there is nothing to match a Member on — a LINE account that withheld the
  // email scope lands here.
  if (!identity.email) return { outcome: "not-registered" };

  const member = await getMemberByEmail(db, identity.email);
  if (!member) return { outcome: "not-registered" };
  if (member.status !== "active") return { outcome: "inactive" };

  return { outcome: "link-required", email: identity.email };
}

// The link intent travels in a signed cookie rather than a server row: it is worthless without the
// password that follows, and a table would need its own expiry sweep.
//
// `|` separates the fields because no provider's subject identifier and no address contains one —
// Google and Facebook issue digits, LINE issues `U…`.
export function encodeLinkIntent(provider: OAuthProvider, identity: SocialIdentity & { email: string }): string {
  return `${provider}|${identity.providerUserId}|${identity.email}`;
}

export function signLinkIntent(secret: string | undefined, provider: OAuthProvider, identity: SocialIdentity & { email: string }): Promise<string> {
  return signToken(secret, "social-link", encodeLinkIntent(provider, identity), SOCIAL_LINK_TTL_SECONDS);
}

export interface LinkIntent {
  provider: OAuthProvider;
  providerUserId: string;
  email: string;
}

export async function readLinkIntent(secret: string | undefined, token: string): Promise<LinkIntent | null> {
  const subject = await verifyToken(secret, "social-link", token);
  if (!subject) return null;

  const [provider, providerUserId, email] = subject.split("|");
  if (!provider || !providerUserId || !email) return null;
  return { provider: provider as OAuthProvider, providerUserId, email };
}

// Called after a password login succeeded. Returns the provider it linked, or null — a link that
// cannot be completed must never fail the login it rode in on, because the member did prove who
// they are.
export async function completeSocialLink(db: DbClient, secret: string | undefined, token: string, member: MemberRow): Promise<OAuthProvider | null> {
  const intent = await readLinkIntent(secret, token);
  if (!intent) return null;

  // The address in the intent is the one the provider asserted. Requiring it to equal the address
  // that just authenticated is the whole check: without it, a stolen intent cookie would attach an
  // attacker's provider account to whoever logs in next.
  if (intent.email !== member.email.toLowerCase()) return null;

  const [existing] = await db
    .select({ id: socialAccounts.id })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.provider, intent.provider), eq(socialAccounts.providerUserId, intent.providerUserId)))
    .limit(1);

  // Claimed in the meantime. Not an error to report: the link either exists already or belongs to
  // someone else, and neither is the member's problem.
  if (existing) return null;

  await db.insert(socialAccounts).values({ memberId: member.id, provider: intent.provider, providerUserId: intent.providerUserId, updatedAt: new Date().toISOString() });
  return intent.provider;
}

export async function listLinkedProviders(db: DbClient, memberId: number): Promise<OAuthProvider[]> {
  const rows = await db.select({ provider: socialAccounts.provider }).from(socialAccounts).where(eq(socialAccounts.memberId, memberId));
  return rows.map((row) => row.provider);
}
