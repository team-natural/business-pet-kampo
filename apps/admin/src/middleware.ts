import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { UnauthenticatedError } from "@app/server-kit/http";
import { resolveAccessEmail } from "$lib/server/auth/access";

// Unlike apps/public, authentication is verified here rather than per route: every route in this
// app is privileged, so one page that forgets the check is a hole (D-022). CSP belongs in
// astro.config.mjs, not here.
function withSecurityHeaders(response: Response): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

// Access is configured to bypass these, so the request arrives with no identity to resolve and
// the check below would answer 403 — the monitor would see that, not the health of the app
// (DEV-08 §9). Matched as an exact path, never a prefix: `startsWith` would also exempt
// `/api/v1/health-is-a-lie/orders`.
const PUBLIC_PATHS = new Set(["/api/v1/health", "/api/v1/health/db"]);

export const onRequest = defineMiddleware(async (context, next) => {
  if (PUBLIC_PATHS.has(context.url.pathname)) {
    context.locals.accessEmail = null;
    context.locals.db = createDb(env.DB);
    return withSecurityHeaders(await next());
  }

  try {
    context.locals.accessEmail = await resolveAccessEmail(context, env);
  } catch (error) {
    // Only a rejected identity becomes a 403. A missing CF_ACCESS_* var throws on, so a
    // misconfigured deployment fails loudly instead of looking like everyone lost access.
    if (!(error instanceof UnauthenticatedError)) throw error;
    return withSecurityHeaders(new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } }));
  }

  context.locals.db = createDb(env.DB);
  return withSecurityHeaders(await next());
});
