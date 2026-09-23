// Liveness probes (DEV-08 §9). Kept in the service layer rather than inlined into the routes so
// that D1 access stays on one side of the boundary, health check or not (DEV-01 §8).
import type { DbClient } from "@app/schema/client";
import { sql } from "drizzle-orm";

// Returns a boolean rather than throwing: the route turns it into a status code, and the reason
// belongs in the log, not in a response an unauthenticated monitor can read.
export async function checkDatabase(db: DbClient): Promise<boolean> {
  try {
    await db.run(sql`select 1`);
    return true;
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Health check failed", check: "db", reason: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}

// A read, not a write: a probe that wrote on every poll would bill for it and could itself be the
// thing that breaks under load.
export async function checkKv(kv: KVNamespace): Promise<boolean> {
  try {
    await kv.get("health-probe");
    return true;
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Health check failed", check: "kv", reason: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}
