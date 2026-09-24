// Account activation: the first password, set from the link mailed when the application was
// approved (F-01-05). Unauthenticated — the token is the whole credential.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { UnauthenticatedError, ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { MEMBER_SESSION_COOKIE } from "$lib/server/auth/session";
import { activateAccount } from "$lib/server/services/auth";
import { toPublicMember } from "$lib/server/services/members";
import { activateSchema } from "$lib/server/validation/auth";
import { sessionCookieOptions } from "$lib/server/auth/cookie";

// A Workers Secret, so it is absent from the generated Cloudflare.Env (DEV-10 §1-3).
const secrets = env as typeof env & { SESSION_SIGNING_KEY?: string };

export async function POST({ request, cookies }: APIContext): Promise<Response> {
  try {
    const { token, password } = activateSchema.parse(await request.json());
    const db = createDb(env.DB);

    // Signing in straight after is deliberate: the member just proved they hold the mailed link
    // and chose a password, which is the same evidence a login asks for.
    const { session, member } = await activateAccount(db, secrets.SESSION_SIGNING_KEY, token, password, Number(env.SESSION_TTL_DAYS));
    cookies.set(MEMBER_SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));

    return jsonItem(toPublicMember(member));
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    // Every failure the service raises is already the same UnauthenticatedError; nothing here
    // narrows it further.
    if (error instanceof UnauthenticatedError) return toErrorResponse(error);
    return toErrorResponse(error);
  }
}
