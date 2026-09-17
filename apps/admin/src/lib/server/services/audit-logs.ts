// 監査ログの参照（ADM-24）。書き込みは各 Service が activity-log.ts 経由で行い、ここは読むだけ。
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

// カーソル方式。総件数を数えないので、画面にも「総件数」「最終ページ」を出さない（DEV-06 §4-2）。
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
