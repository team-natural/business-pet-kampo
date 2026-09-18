// Keyset paginated: nothing counts the rows, so `meta` carries no total (DEV-04 §3-2).
import type { APIContext } from "astro";
import { decodeCursor, encodeCursor, jsonCursorCollection, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { listActivityLogs } from "$lib/server/services/audit-logs";

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);

    const params = context.url.searchParams;
    const { items, perPage, nextId } = await listActivityLogs(context.locals.db, {
      beforeId: decodeCursor(params.get("cursor")),
      perPage: params.get("per_page") ? Number(params.get("per_page")) : undefined,
      logName: params.get("log_name") ?? undefined,
    });

    return jsonCursorCollection(items, { perPage, nextCursor: nextId ? encodeCursor(nextId) : null });
  } catch (error) {
    return toErrorResponse(error);
  }
}
