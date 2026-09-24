// Audit log writer. Called inline from the Service function performing the change, not from a
// cross-cutting logger that would have to re-derive what counts as loggable (DEV-05 §9-1).
//
// Shared rather than owned by apps/admin: member-initiated changes are logged too (a company
// change request, a withdrawal), and the boundary rules stop apps/public importing from the other
// app. The table is in packages/schema, so the one writer for it lives here as well.
import { activityLog } from "./schema";
import type { DbClient } from "./client";
import type { SQL } from "drizzle-orm";

export interface ActivityLogEntry {
  logName?: string;
  description: string;
  subjectType?: string;
  subjectId?: number;
  event?: string;
  // "AdminUser" or "Member" (DEV-07 §4-2). Defaults to AdminUser because that is who most of these
  // belong to; a member-initiated entry has to say so.
  causerType?: string;
  // Omit for system-driven changes with no human actor — never invent a "system" AdminUser row.
  causerId?: number;
  // Required for anything touching an order, a trading partner or a cart (DEV-05 §9-1). Null only
  // where the subject belongs to no organization at all — handling an inquiry, reviewing an
  // application that has not been approved yet.
  //
  // Accepts SQL so a caller inside a batch can point at a row the same batch is inserting, which
  // is the only way to reference it — D1 cannot hand a generated id back mid-batch.
  organizationId?: number | SQL<number>;
  properties?: Record<string, unknown>;
}

// Returned unexecuted so the caller can batch it with the change it describes — D1 runs a batch
// as one transaction, so the log cannot outlive a rolled-back write.
export function activityLogInsert(db: DbClient, entry: ActivityLogEntry) {
  return db.insert(activityLog).values({
    logName: entry.logName ?? null,
    description: entry.description,
    subjectType: entry.subjectType ?? null,
    subjectId: entry.subjectId ?? null,
    event: entry.event ?? null,
    causerType: entry.causerType ?? "AdminUser",
    causerId: entry.causerId ?? null,
    organizationId: entry.organizationId ?? null,
    properties: entry.properties ? JSON.stringify(entry.properties) : null,
    batchId: null,
  });
}
