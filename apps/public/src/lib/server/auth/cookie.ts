// The session cookie's attributes, in one place. Login, activation and reset all issue the same
// cookie, and a flag that drifts on one of them is a flag nobody notices is missing.
import type { AstroCookieSetOptions } from "astro";

// The three cookies that carry an OAuth round trip. Named here so the callback and the login route
// cannot disagree with the route that set them.
export const OAUTH_STATE_COOKIE = "oauth_state";
export const OAUTH_VERIFIER_COOKIE = "oauth_code_verifier";
export const OAUTH_LINK_COOKIE = "oauth_link_intent";

// A visitor has ten minutes to finish at the provider; after that the round trip starts again.
const OAUTH_HANDOFF_MAX_AGE = 10 * 60;

// SameSite=Lax is load-bearing, not a default: the provider sends the browser back here from
// another origin, and Strict drops the cookie on exactly that navigation.
export function oauthHandoffCookieOptions(maxAge = OAUTH_HANDOFF_MAX_AGE): AstroCookieSetOptions {
  return { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge };
}

export function sessionCookieOptions(expiresAt: string): AstroCookieSetOptions {
  return {
    // No JS reads this; an XSS that could would otherwise walk off with the session.
    httpOnly: true,
    // Browsers treat http://localhost as a secure context, so this holds in local dev too.
    secure: true,
    // Lax, not Strict: a member following a link from their mail client must land logged in.
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  };
}
