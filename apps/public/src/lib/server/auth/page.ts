// Page-side authentication. Unlike an API route a page redirects instead of answering 401, and
// unlike apps/admin there is no middleware doing it centrally (DEV-05 §1) — each member page
// guards itself with requireMemberSession at the top of its frontmatter.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { type Session, type SessionOrganization, getSession } from "./session";

// Structural, not APIContext: the `Astro` global of a page satisfies this but is not an
// APIContext, and every call site passes it.
type PageContext = Pick<APIContext, "cookies" | "url" | "redirect">;

// For pages that render either way — the catalog shows a wholesale price to a member and a
// prompt to everyone else (D-021).
export async function memberSession(context: PageContext): Promise<Session | null> {
  return getSession(context.cookies, createDb(env.DB));
}

// For member-only pages. Returns the session, or the redirect to send instead of rendering; the
// caller decides with `instanceof Response`. Returning the redirect rather than throwing keeps
// the guard visible in the page's own frontmatter.
export async function requireMemberSession(context: PageContext): Promise<Session | Response> {
  const session = await memberSession(context);
  if (session) return session;

  // Carries where the visitor was headed, so login can send them back rather than to the top page.
  return context.redirect(`/login?next=${encodeURIComponent(context.url.pathname + context.url.search)}`);
}

// The page equivalent of requireActiveOrganization. That one throws, which on a page is a 500
// rather than a refusal — a page has to answer with a redirect. Mypage top is the destination
// because it is where the trading status is explained.
export function requireActiveOrganizationForPage(context: PageContext, session: Session): SessionOrganization | Response {
  const organization = session.organization;
  if (!organization || organization.status !== "active" || organization.membershipStatus !== "active") return context.redirect("/mypage");
  return organization;
}
