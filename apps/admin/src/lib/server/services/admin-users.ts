// The ledger behind Cloudflare Access (D-022): rows exist so activity_log.causer_id,
// inquiries.assignee_id and applications.reviewer_id have something to point at. No password, no
// session — provisioning happens on the first Access-authenticated request.
import { adminUsers } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { eq } from "drizzle-orm";

export type AdminUser = typeof adminUsers.$inferSelect;

// Refreshed at most hourly. Writing it on every admin request would double this app's D1 writes
// to record something nobody reads at that resolution.
const LAST_LOGIN_REFRESH_MS = 60 * 60 * 1000;

// The internal integer id never leaves this layer.
export function toPublicAdminUser(user: AdminUser) {
  return {
    id: user.publicId,
    name: user.name,
    email: user.email,
    status: user.status,
  };
}

export async function getAdminUserByEmail(db: DbClient, email: string) {
  const [row] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
  return row ?? null;
}

export async function getAdminUserByPublicId(db: DbClient, publicId: string) {
  const [row] = await db.select().from(adminUsers).where(eq(adminUsers.publicId, publicId)).limit(1);
  return row ?? null;
}

export async function findOrCreateAdminUserByEmail(db: DbClient, email: string): Promise<AdminUser> {
  const existing = await getAdminUserByEmail(db, email);
  if (existing) return existing;

  // The display name is a placeholder until someone edits it: the Access JWT carries an email,
  // not a name.
  await db
    .insert(adminUsers)
    .values({
      publicId: ulid(),
      name: email.split("@")[0] || email,
      email,
      status: "active",
      updatedAt: new Date().toISOString(),
    })
    // Two first requests in flight at once would otherwise race the unique index and 500 one of
    // them, so the insert yields and the row is read back either way.
    .onConflictDoNothing();

  const created = await getAdminUserByEmail(db, email);
  if (!created) throw new Error(`Failed to provision admin user for ${email}.`);
  return created;
}

export async function touchLastLoginIfStale(db: DbClient, user: AdminUser): Promise<void> {
  if (user.lastLoginAt && Date.now() - Date.parse(user.lastLoginAt) < LAST_LOGIN_REFRESH_MS) return;
  await db.update(adminUsers).set({ lastLoginAt: new Date().toISOString() }).where(eq(adminUsers.id, user.id));
}
