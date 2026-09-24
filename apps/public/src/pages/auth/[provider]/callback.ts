// SCR-08, the OAuth callback. A page route with no page (DEV-06 §1-2) — every outcome is a
// redirect.
//
// Authenticating with a provider is not approval. An address with no approved application gets no
// Member and no session; it goes to the application form (DEV-10 §5-3, INTAKE §7).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { OAuthExchangeError, exchangeCode, isOAuthProvider, type OAuthEnv } from "$lib/server/auth/oauth";
import { MEMBER_SESSION_COOKIE } from "$lib/server/auth/session";
import { OAUTH_LINK_COOKIE, OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, oauthHandoffCookieOptions, sessionCookieOptions } from "$lib/server/auth/cookie";
import { SOCIAL_LINK_TTL_SECONDS, loginWithSocialIdentity, signLinkIntent } from "$lib/server/services/social-auth";

// Workers Secrets, so they are absent from the generated Cloudflare.Env (DEV-10 §1-3).
const secrets = env as typeof env & OAuthEnv & { SESSION_SIGNING_KEY?: string };

export async function GET({ params, url, cookies, redirect }: APIContext): Promise<Response> {
  if (!isOAuthProvider(params.provider)) return new Response("Not Found", { status: 404 });
  const provider = params.provider;

  const state = cookies.get(OAUTH_STATE_COOKIE)?.value;
  const codeVerifier = cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  cookies.delete(OAUTH_STATE_COOKIE, { path: "/" });
  cookies.delete(OAUTH_VERIFIER_COOKIE, { path: "/" });

  const code = url.searchParams.get("code");
  // One answer for a missing code, a mismatched state and a denied consent. Telling them apart
  // tells whoever forged the callback which half was wrong.
  if (!code || !state || url.searchParams.get("state") !== state) return redirect("/login?error=oauth", 302);

  let identity;
  try {
    identity = await exchangeCode(secrets, provider, code, codeVerifier ?? "");
  } catch (error) {
    // Logged, not shown: the provider's message is for us, and the visitor can only retry.
    console.error(error instanceof OAuthExchangeError ? error.message : error);
    return redirect("/login?error=oauth", 302);
  }

  const result = await loginWithSocialIdentity(createDb(env.DB), provider, identity, Number(env.SESSION_TTL_DAYS));

  if (result.outcome === "signed-in") {
    cookies.set(MEMBER_SESSION_COOKIE, result.session.token, sessionCookieOptions(result.session.expiresAt));
    return redirect("/mypage", 302);
  }

  if (result.outcome === "link-required") {
    // Offered, never performed here: anyone can create a provider account claiming any address, so
    // the password that follows is what proves the two are the same person (DEV-10 §5-3).
    try {
      const token = await signLinkIntent(secrets.SESSION_SIGNING_KEY, provider, { ...identity, email: result.email });
      cookies.set(OAUTH_LINK_COOKIE, token, oauthHandoffCookieOptions(SOCIAL_LINK_TTL_SECONDS));
      return redirect(`/login?link=${provider}`, 302);
    } catch (error) {
      // An unset signing key is a misconfigured deployment, not a routine outcome — but the
      // member can still sign in with their password, so send them to do that.
      console.error(error);
      return redirect("/login?error=oauth", 302);
    }
  }

  // "inactive" and "not-registered" answer the same way on purpose. A distinct message would tell
  // an outsider whether an address belongs to an approved trading partner (DEV-02 §7).
  return redirect("/apply?reason=not_registered", 302);
}
