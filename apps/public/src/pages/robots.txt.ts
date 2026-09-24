// Served from a route rather than public/robots.txt: the sitemap line needs the absolute origin,
// and taking it from APP_URL keeps staging from advertising the production domain.
//
// The Disallow list is a courtesy, not a control — anything that must not be read is refused by
// the session check, and the middleware sets X-Robots-Tag on the same routes (PRD-02 §9).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";

const DISALLOWED = ["/mypage/", "/cart", "/checkout", "/api/", "/login", "/activate/", "/apply/cancel/"];

export async function GET({ url }: APIContext): Promise<Response> {
  const origin = (env.APP_URL ?? url.origin).replace(/\/$/, "");

  const body = ["User-agent: *", ...DISALLOWED.map((path) => `Disallow: ${path}`), "", `Sitemap: ${origin}/sitemap.xml`, ""].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
