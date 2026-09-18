// TODO(Phase C): the member asking to close the account. Nothing here moves a `status` — the
// operator's transition function owns that, and this route only records the request and notifies
// (DEV-09 §2-2).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { toErrorResponse } from "@app/server-kit/http";
import { requireSession } from "$lib/server/auth/session";

export async function POST({ cookies }: APIContext): Promise<Response> {
  try {
    await requireSession(cookies, createDb(env.DB));
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
