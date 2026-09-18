// TODO(Phase C): quantity change and removal. `[id]` is the cart_items row id, but every update
// and delete still carries organization_id and member_id in its WHERE clause — nobody reaches
// another company's cart, or a colleague's.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { toErrorResponse } from "@app/server-kit/http";
import { requireOrderableOrganization, requireSession } from "$lib/server/auth/session";

export async function PATCH({ cookies }: APIContext): Promise<Response> {
  try {
    requireOrderableOrganization(await requireSession(cookies, createDb(env.DB)));
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE({ cookies }: APIContext): Promise<Response> {
  try {
    requireOrderableOrganization(await requireSession(cookies, createDb(env.DB)));
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
