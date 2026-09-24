// Reading the audit log (ADM-24). Writes happen in each service through
// @app/schema/activity-log; this file only reads.
import { activityLog } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { and, desc, eq, lt } from "drizzle-orm";

type ActivityLogRow = typeof activityLog.$inferSelect;

export function toPublicActivityLog(row: ActivityLogRow) {
  return {
    id: row.id,
    logName: row.logName,
    description: row.description,
    event: row.event,
    subjectType: row.subjectType,
    causerType: row.causerType,
    properties: row.properties ? (JSON.parse(row.properties) as Record<string, unknown>) : null,
    createdAt: row.createdAt,
  };
}

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

// Keyset pagination. Nothing counts the rows, so the screen shows no total and no last page
// (DEV-06 §4-2).
export async function listActivityLogs(db: DbClient, options: { beforeId?: number | null; perPage?: number; logName?: string } = {}) {
  const perPage = Math.min(Math.max(options.perPage ?? DEFAULT_PER_PAGE, 1), MAX_PER_PAGE);

  const rows = await db
    .select()
    .from(activityLog)
    .where(and(options.beforeId ? lt(activityLog.id, options.beforeId) : undefined, options.logName ? eq(activityLog.logName, options.logName) : undefined))
    .orderBy(desc(activityLog.id))
    .limit(perPage + 1);

  const hasMore = rows.length > perPage;
  const page = rows.slice(0, perPage);
  return { items: page.map(toPublicActivityLog), perPage, nextId: hasMore ? page[page.length - 1]!.id : null };
}
