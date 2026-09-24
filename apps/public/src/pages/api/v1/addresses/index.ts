import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { createAddress, listAddresses } from "$lib/server/services/addresses";
import { addressSchema } from "$lib/server/validation/addresses";

export async function GET({ cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    const organization = requireActiveOrganization(session);

    return jsonItem(await listAddresses(db, organization.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST({ request, cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    // From the session, never from the body — addressSchema has no organizationId to send.
    const organization = requireActiveOrganization(await requireSession(cookies, db));

    const input = addressSchema.parse(await request.json());
    return jsonItem(await createAddress(db, organization.id, input), 201);
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
