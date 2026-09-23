// Liveness only — it touches no binding, so it stays 200 while D1 is down and tells the monitor
// the Worker itself is serving (DEV-08 §9).
// Monitors poll this; a cached 200 would keep reporting health after the Worker stopped serving.
const HEADERS = { "cache-control": "no-store" };

export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: HEADERS });
}
