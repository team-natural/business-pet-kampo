// Page-side authentication. Unlike an API route a page redirects instead of answering 401, and
// unlike apps/admin there is no middleware doing it centrally (DEV-05 §1) — each page guards
// itself with these two calls at the top of its frontmatter.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { type Session, getSession } from "./session";

// Structural, not APIContext: the `Astro` global of a page satisfies this but is not an
// APIContext, and both call sites pass it.
type PageContext = Pick<APIContext, "cookies" | "url" | "redirect">;

export async function memberSession(context: PageContext): Promise<Session | null> {
  return getSession(context.cookies, createDb(env.DB));
}

// Carries where the visitor was headed, so login can send them back rather than to the top page.
export function loginRedirect(context: PageContext): Response {
  return context.redirect(`/login?next=${encodeURIComponent(context.url.pathname + context.url.search)}`);
}
