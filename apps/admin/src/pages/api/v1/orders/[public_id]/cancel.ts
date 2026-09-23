// TODO(Phase C): cancellation and the refund state. The refund is computed from the line
// snapshots; packages/content is never re-read to recalculate it (DEV-07 §6-0).
import type { APIContext } from "astro";
import { toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";

export async function POST(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
