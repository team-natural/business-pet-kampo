// Listed in middleware.ts's PUBLIC_PATHS: Access bypasses it, so no identity reaches here and
// none is required (DEV-08 §9). It touches no binding and reveals nothing about the app.
const HEADERS = { "cache-control": "no-store" };

export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: HEADERS });
}
