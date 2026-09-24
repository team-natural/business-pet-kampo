// SCR-08, the OAuth start. A page route with no page (DEV-06 §1-2): it only ever answers with a
// redirect, so it has no JSON envelope and does not belong under /api/v1 (DEV-04 §5-1).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createAuthorizationRequest, isOAuthProvider, type OAuthEnv } from "$lib/server/auth/oauth";
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, oauthHandoffCookieOptions } from "$lib/server/auth/cookie";

// Workers Secrets, so they are absent from the generated Cloudflare.Env (DEV-10 §1-3).
const secrets = env as typeof env & OAuthEnv;

export async function GET({ params, cookies, redirect }: APIContext): Promise<Response> {
  // Allow-listed rather than passed through: an unknown provider must not reach the OAuth code.
  if (!isOAuthProvider(params.provider)) return new Response("Not Found", { status: 404 });

  // Null means the provider has no credentials configured. 404 rather than 500 — the button is
  // hidden too, so reaching this is a typed URL, not a broken deployment (D-036).
  const request = createAuthorizationRequest(secrets, params.provider);
  if (!request) return new Response("Not Found", { status: 404 });

  // SameSite=Lax, not Strict: these have to survive the provider redirecting the browser back
  // here from another site, which is exactly the navigation Strict drops.
  cookies.set(OAUTH_STATE_COOKIE, request.state, oauthHandoffCookieOptions());
  cookies.set(OAUTH_VERIFIER_COOKIE, request.codeVerifier, oauthHandoffCookieOptions());

  return redirect(request.url, 302);
}
