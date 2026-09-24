// Built at request time from the collections, not by @astrojs/sitemap. The integration crawls
// statically-generated routes and, in its own words, "cannot generate sitemap entries for dynamic
// routes in SSR mode" — and D-021 forbids prerendering the product and news pages, which is
// precisely what the sitemap is for. Generating it here is the only way it can be complete
// (GOV-01 D-037, PRD-02 §9).
//
// The origin comes from APP_URL rather than astro.config's `site`, so nothing here has to wait on
// the domain being settled (TBD-16).
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { sitemapPaths } from "$lib/catalog";

// Escaped even though every path is developer-authored: a slug with an ampersand would otherwise
// produce XML that no crawler can parse, and the failure is silent.
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export async function GET({ url }: APIContext): Promise<Response> {
  const origin = (env.APP_URL ?? url.origin).replace(/\/$/, "");
  const paths = await sitemapPaths();

  const body = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...paths.map((path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`), "</urlset>"].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Content changes only on deploy, but a stale sitemap is harmless for an hour and this
      // spares the collections a walk per crawler hit.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
