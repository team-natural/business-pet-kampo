// The session cookie's attributes, in one place. Login, activation and reset all issue the same
// cookie, and a flag that drifts on one of them is a flag nobody notices is missing.
import type { AstroCookieSetOptions } from "astro";

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
