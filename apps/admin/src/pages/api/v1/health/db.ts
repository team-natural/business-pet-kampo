// Also in middleware.ts's PUBLIC_PATHS. The db handle comes from locals, which middleware sets on
// the bypass path too — there is no identity here, but there is still a database to probe.
import type { APIContext } from "astro";
import { checkDatabase } from "$lib/server/services/health";

const HEADERS = { "cache-control": "no-store" };

export async function GET(context: APIContext): Promise<Response> {
  const ok = await checkDatabase(context.locals.db);
  // 503 rather than 500: the Worker is fine, its dependency is not.
  return Response.json({ status: ok ? "ok" : "error", check: "db" }, { status: ok ? 200 : 503, headers: HEADERS });
}
