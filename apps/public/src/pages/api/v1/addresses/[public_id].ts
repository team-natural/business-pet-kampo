// Both verbs read through the service's getAddress first, which scopes to the session's
// organization — existence and authorization are settled by the same query, so another company's
// address is 404 rather than 403 (DEV-02 §3-1).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { deleteAddress, updateAddress } from "$lib/server/services/addresses";
import { addressSchema } from "$lib/server/validation/addresses";

export async function PATCH({ request, cookies, params }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const organization = requireActiveOrganization(await requireSession(cookies, db));

    const input = addressSchema.parse(await request.json());
    return jsonItem(await updateAddress(db, organization.id, params.public_id!, input));
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}

export async function DELETE({ cookies, params }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const organization = requireActiveOrganization(await requireSession(cookies, db));

    await deleteAddress(db, organization.id, params.public_id!);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
