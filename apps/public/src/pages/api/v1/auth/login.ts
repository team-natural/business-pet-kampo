// `member_session` cookie only — no Authorization header, no JWT.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { assertNotLockedOut, clearAuthFailures, recordAuthFailure } from "@app/server-kit/auth";
import { UnauthenticatedError, ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { MEMBER_SESSION_COOKIE } from "$lib/server/auth/session";
import { OAUTH_LINK_COOKIE, sessionCookieOptions } from "$lib/server/auth/cookie";
import { toPublicMember } from "$lib/server/services/members";
import { login } from "$lib/server/services/auth";
import { completeSocialLink } from "$lib/server/services/social-auth";
import { loginSchema } from "$lib/server/validation/auth";
import { createDb } from "@app/schema/client";

// A Workers Secret, so it is absent from the generated Cloudflare.Env (DEV-10 §1-3).
const secrets = env as typeof env & { SESSION_SIGNING_KEY?: string };

export async function POST({ request, cookies, clientAddress }: APIContext): Promise<Response> {
  let lockoutScope: { ip: string; email: string } | undefined;
  try {
    const db = createDb(env.DB);
    const { email, password } = loginSchema.parse(await request.json());

    // Check lockout before verifying credentials.
    const ip = request.headers.get("cf-connecting-ip") ?? clientAddress;
    lockoutScope = { ip, email };
    await assertNotLockedOut(env.KV, ip, email);

    const ttlDays = Number(env.SESSION_TTL_DAYS);
    const { session, member } = await login(db, email, password, ttlDays);
    await clearAuthFailures(env.KV, ip, email);

    cookies.set(MEMBER_SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));

    // A social login that found this address but no link sent them here to prove ownership with
    // their password. They just did, so the link can be made — and only now (DEV-10 §5-3).
    let linkedProvider = null;
    const linkIntent = cookies.get(OAUTH_LINK_COOKIE)?.value;
    if (linkIntent) {
      cookies.delete(OAUTH_LINK_COOKIE, { path: "/" });
      // A link that cannot be completed must not fail the login it rode in on: the password was
      // correct, and that is what this endpoint answers for.
      linkedProvider = await completeSocialLink(db, secrets.SESSION_SIGNING_KEY, linkIntent, member);
    }

    return jsonItem({ ...toPublicMember(member), linkedProvider });
  } catch (error) {
    if (error instanceof UnauthenticatedError && lockoutScope) {
      await recordAuthFailure(env.KV, lockoutScope.ip, lockoutScope.email, {
        maxAttempts: Number(env.AUTH_LOCKOUT_MAX_ATTEMPTS),
        lockoutMinutes: Number(env.AUTH_LOCKOUT_MINUTES),
      });
    }
    if (error instanceof ZodError) {
      return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    }
    return toErrorResponse(error);
  }
}
