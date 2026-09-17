// Member sessions. Deliberately a separate table, cookie and module from apps/admin, which has
// no app-level session at all — its authentication is Cloudflare Access (D-022). The shared rules
// live in @app/server-kit/auth, the storage never does.
import type { AstroCookies } from "astro";
import { isActiveSession, newSessionToken, sessionExpiresAt } from "@app/server-kit/auth";
import { ForbiddenError, UnauthenticatedError } from "@app/server-kit/http";
import { memberSessions, members, memberships, organizations } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { and, eq } from "drizzle-orm";

export const MEMBER_SESSION_COOKIE = "member_session";

export interface SessionOrganization {
  id: number;
  publicId: string;
  // The key the per-organization price files reference (D-019).
  orgCode: string;
  name: string;
  status: "active" | "suspended" | "terminated";
  orderEnabled: boolean;
  membershipStatus: "active" | "suspended";
}

export interface Session {
  memberId: number;
  memberPublicId: string;
  // Resolved at session lookup rather than per query: every order-related statement is scoped by
  // organization_id, and re-deriving it per call site is how one of them ends up unscoped.
  organization: SessionOrganization | null;
}

export async function getSession(cookies: AstroCookies, db: DbClient): Promise<Session | null> {
  const token = cookies.get(MEMBER_SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      memberId: members.id,
      memberPublicId: members.publicId,
      status: members.status,
      expiresAt: memberSessions.expiresAt,
    })
    .from(memberSessions)
    .innerJoin(members, eq(memberSessions.memberId, members.id))
    .where(eq(memberSessions.sessionToken, token))
    .limit(1);

  if (!row || !isActiveSession(row)) return null;

  return { memberId: row.memberId, memberPublicId: row.memberPublicId, organization: await getSessionOrganization(db, row.memberId) };
}

// A suspended or terminated organization still resolves: its members keep logging in, and it is
// the per-request authorization below that refuses to let them order (DEV-09 §2-2).
async function getSessionOrganization(db: DbClient, memberId: number): Promise<SessionOrganization | null> {
  const [row] = await db
    .select({
      id: organizations.id,
      publicId: organizations.publicId,
      orgCode: organizations.orgCode,
      name: organizations.name,
      status: organizations.status,
      orderEnabled: organizations.orderEnabled,
      membershipStatus: memberships.status,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.memberId, memberId))
    .limit(1);

  return row ? { ...row, orderEnabled: row.orderEnabled === 1 } : null;
}

export async function requireSession(cookies: AstroCookies, db: DbClient): Promise<Session> {
  const session = await getSession(cookies, db);
  if (!session) throw new UnauthenticatedError();
  return session;
}

// Wholesale prices and member-only news need this, ordering needs the stricter check below.
export function requireActiveOrganization(session: Session): SessionOrganization {
  const organization = session.organization;
  if (!organization || organization.status !== "active" || organization.membershipStatus !== "active") {
    throw new ForbiddenError("この操作を行える取引先アカウントではありません。");
  }
  return organization;
}

export function requireOrderableOrganization(session: Session): SessionOrganization {
  const organization = requireActiveOrganization(session);
  if (!organization.orderEnabled) throw new ForbiddenError("現在ご発注を承れません。担当までお問い合わせください。");
  return organization;
}

// What catalog.ts needs to pick a price: null for anyone who must not see one (PRD-02 §2-3).
export function viewerFor(session: Session | null) {
  if (!session?.organization) return null;
  const { status, membershipStatus, orgCode } = session.organization;
  return status === "active" && membershipStatus === "active" ? { orgCode } : null;
}

export async function createSession(db: DbClient, memberId: number, ttlDays: number): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = sessionExpiresAt(ttlDays);
  const token = newSessionToken();
  await db.insert(memberSessions).values({ memberId, sessionToken: token, expiresAt });
  return { token, expiresAt };
}

export async function destroySession(db: DbClient, token: string): Promise<void> {
  await db.delete(memberSessions).where(eq(memberSessions.sessionToken, token));
}

// Suspending or deactivating an account drops its sessions immediately (DEV-09 §2-3).
export async function destroySessionsForMember(db: DbClient, memberId: number): Promise<void> {
  await db.delete(memberSessions).where(eq(memberSessions.memberId, memberId));
}

// Used by the membership lookups above; exported for the services that need the same scoping.
export async function hasActiveMembership(db: DbClient, memberId: number, organizationId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.memberId, memberId), eq(memberships.organizationId, organizationId), eq(memberships.status, "active")))
    .limit(1);
  return row !== undefined;
}
