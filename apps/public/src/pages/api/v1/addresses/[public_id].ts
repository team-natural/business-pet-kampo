// TODO(Phase C): PATCH / DELETE. Both read through getAddress first, which scopes to the
// session's organization — existence and authorization settled by the same query.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { toErrorResponse } from "@app/server-kit/http";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { getAddress } from "$lib/server/services/addresses";

async function guard({ cookies, params }: APIContext) {
  const db = createDb(env.DB);
  const organization = requireActiveOrganization(await requireSession(cookies, db));
  await getAddress(db, organization.id, params.public_id!);
}

export async function PATCH(context: APIContext): Promise<Response> {
  try {
    await guard(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(context: APIContext): Promise<Response> {
  try {
    await guard(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
