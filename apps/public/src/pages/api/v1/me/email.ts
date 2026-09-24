// Confirming a new address (F-01-06). Reached from the link mailed to the new address, so the
// token — not the session — is what proves the change was wanted.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError, z } from "zod";
import { confirmEmailChange } from "$lib/server/services/members";

// A Workers Secret, so it is absent from the generated Cloudflare.Env (DEV-10 §1-3).
const secrets = env as typeof env & { SESSION_SIGNING_KEY?: string };

const confirmSchema = z.object({ token: z.string().min(1).max(512) });

export async function POST({ request }: APIContext): Promise<Response> {
  try {
    const { token } = confirmSchema.parse(await request.json());
    // No session requirement: the member may well open the link in the browser where the new
    // address's mail is read, which is not the one they are signed in on.
    return jsonItem(await confirmEmailChange(createDb(env.DB), secrets.SESSION_SIGNING_KEY, token));
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
