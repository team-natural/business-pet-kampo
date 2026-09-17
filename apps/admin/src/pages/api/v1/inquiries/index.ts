// Reference API Route. Input and output only — every decision lives in services/inquiries.ts.
import type { APIContext } from "astro";
import { decodeCursor, encodeCursor, jsonCursorCollection, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { listInquiries } from "$lib/server/services/inquiries";

export async function GET(context: APIContext): Promise<Response> {
  try {
    // The Access JWT was verified in middleware.ts; this resolves it to the ledger row.
    await requireAdminUser(context);

    const params = new URL(context.request.url).searchParams;
    const perPageParam = params.get("per_page");
    const { items, perPage, nextId } = await listInquiries(context.locals.db, {
      beforeId: decodeCursor(params.get("cursor")),
      perPage: perPageParam ? Number(perPageParam) : undefined,
    });

    return jsonCursorCollection(items, { perPage, nextCursor: nextId ? encodeCursor(nextId) : null });
  } catch (error) {
    return toErrorResponse(error);
  }
}
