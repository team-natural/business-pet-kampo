// Liveness probes (DEV-08 §9). Deliberately not shared with apps/public: these are two separate
// Workers, and one being healthy says nothing about the other.
import type { DbClient } from "@app/schema/client";
import { sql } from "drizzle-orm";

// Returns a boolean rather than throwing: the route turns it into a status code, and the reason
// belongs in the log. This route is reachable without an Access identity, so the body must not
// describe the failure.
export async function checkDatabase(db: DbClient): Promise<boolean> {
  try {
    await db.run(sql`select 1`);
    return true;
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Health check failed", check: "db", reason: error instanceof Error ? error.message : String(error) }));
    return false;
  }
}
