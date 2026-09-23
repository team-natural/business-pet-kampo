import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { checkDatabase } from "$lib/server/services/health";

const HEADERS = { "cache-control": "no-store" };

export async function GET(): Promise<Response> {
  const ok = await checkDatabase(createDb(env.DB));
  // 503 rather than 500: the Worker is fine, its dependency is not, and that is what a monitor
  // needs to page on. The body says nothing about why — this route is unauthenticated.
  return Response.json({ status: ok ? "ok" : "error", check: "db" }, { status: ok ? 200 : 503, headers: HEADERS });
}
