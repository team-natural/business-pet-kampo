// TODO(Phase C): suspend trading (DEV-09 §2-2). Live sessions are not revoked — refusing the
// order is requireActiveOrganization's job in apps/public, on every request.
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
