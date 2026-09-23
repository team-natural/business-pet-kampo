// TODO(Phase C): end the trading relationship. A terminal state, so it needs a confirmation
// dialog, and suspending the memberships and recording the retention clock belong in the same
// batch() (DEV-09 §2-2).
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
