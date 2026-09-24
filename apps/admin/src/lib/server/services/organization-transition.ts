// The shared half of the three trading-status routes (suspend / resume / terminate). They differ
// only in the target state and whether a reason is required, so the read-notify-write order lives
// here once — getting it wrong on one route is what this prevents.
//
// Takes a db handle and a `defer` callback rather than an APIContext: a service returns domain
// values, not Responses, and the route keeps its own HTTP concerns (DEV-05 §2).
import type { DbClient } from "@app/schema/client";
import type { MailEnv } from "@app/server-kit/mail";
import { notifyOrganizationStatus } from "../mail/organizations";
import type { AdminUser } from "./admin-users";
import { findOrganizationRow, listActiveMemberContacts, transitionOrganization, type OrganizationStatus } from "./organizations";

export interface TransitionOptions {
  admin: AdminUser;
  reason?: string;
  env: MailEnv;
  // ctx.waitUntil, so the mail leaves after the response (DEV-05 §4). Absent in tests, where the
  // notification is asserted separately.
  defer?: (task: Promise<unknown>) => void;
}

export async function changeTradingStatus(db: DbClient, publicId: string, to: OrganizationStatus, options: TransitionOptions) {
  const row = await findOrganizationRow(db, publicId);
  // Read before the write: terminating suspends every membership in the same batch, so asking
  // afterwards returns nobody to notify.
  const recipients = await listActiveMemberContacts(db, row.id);

  const organization = await transitionOrganization(db, publicId, to, options.admin, options.reason);

  // Termination sends nothing — the partner asked for it, and DEV-09 §2-2-4 lists no mail.
  if (to === "active" || to === "suspended") {
    options.defer?.(notifyOrganizationStatus(options.env, to, row.name, recipients));
  }

  return organization;
}
