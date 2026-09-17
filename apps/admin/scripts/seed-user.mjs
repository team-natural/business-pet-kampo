// Seeds a Member login account into the shared D1. It lives in this app because this app's
// wrangler.jsonc owns the database (migrations_dir); apps/public seeds through it too.
// D1 isn't reachable in-process outside the Workers runtime, so this shells out to
// `wrangler d1 execute`. Run via tsx, not node — that's what lets it import the real
// hashPassword/ulid instead of duplicating them.
//
// There is no admin_users path: AdminUsers have no password and are provisioned on their first
// Access-authenticated request (D-022).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashPassword } from "@app/server-kit/auth";
import { ulid } from "@app/schema/ulid";

const TABLE = "members";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([a-z_]+)(?:=(.*))?$/);
    if (match) args[match[1]] = match[2] ?? true;
  }
  return args;
}

// `--password S3cret!` (space instead of `=`) stores `true` here, which passes the usage guard
// and silently seeds an account whose password is the literal "true". Demand `--flag=value` for
// anything carrying a value; valueless flags like --remote stay boolean.
function requireValue(args, key) {
  const value = args[key];
  if (typeof value !== "string" || value === "") {
    console.error(`--${key} needs a value in --${key}=<value> form (a space-separated value is not picked up).`);
    process.exit(1);
  }
  return value;
}

const sqlQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;

const USAGE = "Usage: pnpm seed -- --table=members --email=<email> --password=<password> --name=<name> [--db=<binding or database_name>] [--remote] [--env=<wrangler env>]";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.table !== TABLE || !args.email || !args.password || !args.name) {
    console.error(USAGE);
    process.exit(1);
  }

  const email = requireValue(args, "email");
  const password = requireValue(args, "password");
  const name = requireValue(args, "name");

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const columns = ["public_id", "name", "email", "password_hash", "status", "created_at", "updated_at"];
  const values = [ulid(), name, email, passwordHash, "active", now, now];
  const sql = `INSERT INTO ${TABLE} (${columns.join(", ")}) VALUES (${values.map(sqlQuote).join(", ")});`;

  // Binding name, not database_name: it's valid before a project replaces the placeholders.
  const db = typeof args.db === "string" && args.db !== "" ? args.db : "DB";
  const wranglerArgs = ["wrangler", "d1", "execute", db, args.remote ? "--remote" : "--local", "--command", sql];
  // Matches astro.config.mjs's persistState path — apps/admin and apps/public share local D1.
  if (!args.remote) wranglerArgs.push("--persist-to", "../../.wrangler-state");
  if (args.env) wranglerArgs.splice(4, 0, "--env", args.env);

  const result = spawnSync("npx", wranglerArgs, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Seeded ${email} into ${TABLE} (${args.remote ? "remote" : "local"}).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
