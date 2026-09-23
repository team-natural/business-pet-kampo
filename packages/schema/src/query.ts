// Query helpers shared by the services in both apps. Anything here must compile to a prepared
// statement — no string concatenation reaches SQL (DEV-01 §3).
import { type SQL, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

// SQLite's LIKE has no escape character unless one is declared, so a `%` typed into a search box
// would match every row rather than a literal percent sign.
function escapeLikeWildcards(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

// Substring match on a text column, with the operator's wildcards treated as literal input.
// The doubled backslash is the TypeScript escape: SQLite must receive `escape '\'`, and a single
// one here would collapse to an empty literal that SQLite rejects at run time.
export function likeContains(column: AnySQLiteColumn, keyword: string): SQL {
  return sql`${column} like ${`%${escapeLikeWildcards(keyword)}%`} escape '\\'`;
}
