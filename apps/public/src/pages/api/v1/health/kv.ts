// apps/public only: apps/admin has no KV binding (D-020, D-022), so it has no equivalent route.
import { env } from "cloudflare:workers";
import { checkKv } from "$lib/server/services/health";

const HEADERS = { "cache-control": "no-store" };

export async function GET(): Promise<Response> {
  const ok = await checkKv(env.KV);
  return Response.json({ status: ok ? "ok" : "error", check: "kv" }, { status: ok ? 200 : 503, headers: HEADERS });
}
