# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About this project

**ペット漢方 卸売サイト** — a B2B wholesale site for pet Kampo supplements, built on Astro SSR +
Cloudflare Workers. Retailers submit an application, the operator screens it, and approved
organizations get member accounts that can see wholesale prices and place orders. The service name
and domain are still working titles (GOV-02 TBD-01 / TBD-16).

`apps/public` is the main domain, `apps/admin` a subdomain of the same service. They are separate
Workers sharing **one D1 and nothing else** — no R2 bucket (D-020), and only public has KV.

- **Specs**: `docs/` (25 documents, filled in for this project). `docs/00_README.md` first.
- **Decisions**: `docs/5-governance/01-decision-log.md` (GOV-01, D-001〜D-024) is the record of
  every project-level decision and why. **Read it before proposing a different approach** — most of
  the surprising choices below are explained there.
- **Open questions**: `docs/5-governance/02-open-questions.md` (GOV-02). The P0s are the legal copy
  (TBD-11), the Cloudflare Access rollout (TBD-32), and go-live setup.

## What this project adopts and drops

The template this repo started from ships features whole so they can be removed cleanly. What
happened here:

| Feature | State |
| --- | --- |
| public-side login (`members`) | **kept**. Members reach orders through `memberships` → `organizations` (D-004); OAuth via Arctic is planned (LINE / Google / Facebook) |
| contact form (`inquiries`) | **kept**, but the columns differ from the template: `content` / `assignee_id` / `memo` plus `company_name` and `phone` (DEV-07 §7-2) |
| password reset | **members only**. The template's `password_reset_tokens` is admin-only — repoint it at `members` or replace it. Admins have no password to reset (D-022) |
| admin login (`admin_sessions`) | **deleted** (D-022). Authentication is Cloudflare Access. `admin_users` stays as a ledger with no `password_hash`, because `activity_log.causer_id`, `inquiries.assignee_id` and `applications.reviewer_id` reference it |
| file uploads (`media`, R2) | **deleted** (D-020). No `BUCKET` binding, no `r2_buckets`, no bucket. Product images are committed under `apps/public/src/assets/img/` |
| AI features | **not adopted** (D-005). The product diagnosis is rule-based, and ships as a Coming soon page for now (D-023) |

Two constraints that bite silently, and belong here because they apply whenever the subject comes
up:

- **`database_id` must be identical in both apps.** It also keys the local sqlite file, so a
  mismatch gives each app its own database with no error.
- **That window has closed.** `0000_familiar_junta.sql` exists, so dropping a table is now a
  migration rather than a deletion. `media`, `admin_sessions` and `password_reset_tokens` were
  removed before it was generated; anything else goes out forward-only (DEV-07 §9).

## Content lives outside D1

Products, manufacturers, brands, per-organization wholesale prices, news and the diagnosis rules are
**Markdown in `packages/content`**. Categories, concern tags, the FAQ, commerce constants (shipping,
tax, minimum order, payment methods) and the inquiry type list are **TypeScript constants**. Terms,
privacy and the legal notice are plain `.astro`. **D1 holds only transactional data** — applications,
organizations, members, carts, orders, payments, inquiries, audit log (D-017, D-018, D-024).

Consequences worth knowing before you touch anything:

- **There is no content management screen and no plan for one.** Changing a product price or
  publishing a news post is a deploy. Do not add CRUD for content to `apps/admin` — the admin screens
  are ADM-01/12/13/14/15/16/17/18/22/23/24 and nothing else (PRD-04 §3-2).
- **Never put `prerender = true` on the product or news pages** (D-021). Prices live in the build
  output, so a static page publishes every organization's wholesale price to anonymous visitors. The
  same goes for passing a price into a Svelte island — it lands in the client HTML.
- **`cart_items.product_slug`, `order_items.product_slug` and the `org_code` in the price files
  cannot have foreign keys** — the referent isn't in D1. Validate existence in the service layer;
  that check is the only thing standing in.
- **Display order values from the order's own snapshot columns** (`product_name_snapshot`,
  `unit_price_snapshot`), never by re-reading the Markdown. Re-reading rewrites every past order
  whenever a price changes (DEV-07 §6-0).
- A product's `slug` is referenced by past orders, the diagnosis rules and the public URL. **Treat it
  as immutable** and add a redirect if a rename is unavoidable.
- `draft` and `visibility: client_only` must be filtered in **the listing, the detail page and the
  sitemap**. Filtering only the listing leaves the detail URL live (D-018).
- Read collections through `apps/public/src/lib/catalog.ts`, not `getCollection()` scattered across
  pages — the `draft` / `discontinued` filtering is what gets forgotten.

## Commands

| Command | Notes |
| --- | --- |
| `pnpm dev` | Both apps. public on 5173, admin on 5174 by default |
| `pnpm check` | format + lint + typecheck + unit tests |
| `pnpm test` | Vitest, all packages |
| `pnpm test:e2e` | Playwright. Requires `pnpm db:generate` first |
| `pnpm build` | |
| `pnpm db:generate` | Drizzle → `packages/schema/migrations/` |
| `pnpm db:migrate` | Applies to the shared local D1 |
| `pnpm --filter admin seed -- --table=members --email=… --password=… --name=…` | Values need `=`, not a space. **There is no `--table=admin_users` path any more** — admins are provisioned on their first Access-authenticated request (D-022) |

## Container

`docker-compose.yml` mounts only this repository at `/workspace`; sibling projects on the host are
deliberately invisible. The container just `sleep infinity`s and devcontainer tooling execs in.
Node 24 and the `claude` CLI come from Dev Container Features, so nothing is installed on the host.

Claude Code's auth lives in a named volume (`claude-config` at `/home/vscode/.claude`), not a host
bind mount, so **each project container needs its own `claude` login**. The volume is root-owned on
creation, which is why `setup.sh` chowns it on every `postCreateCommand`.

`setup.sh` also runs `corepack enable` + `pnpm install`, and installs `context-mode`,
`@playwright/mcp` and Chromium. `Dockerfile` adds `uv`, which the Semble MCP server needs.

Ports are published by docker compose only (`devcontainer.json` has no `forwardPorts`), bound to
`127.0.0.1`.

## Local database

Both apps open the same store: `persistState: { path: "../../.wrangler-state" }` in each
`astro.config.mjs`, and every wrangler CLI call passes `--persist-to ../../.wrangler-state`. Drop
that flag and you silently get a second, empty database.

`packages/schema/migrations/` is generated but committed — `0000_familiar_junta.sql` and its
`meta/` snapshots are in the repo, so a fresh clone can run the tests. Regenerate only when the
schema changes, and commit the result. Two consequences:

- Deleting `migrations/` means deleting `.wrangler-state/` too. Regenerating produces a new random
  filename, which no longer matches what `d1_migrations` recorded, and the next apply fails with
  `table already exists`.
- Deleting only the `.sql` file leaves `meta/`, and drizzle-kit then reports "no changes" and
  generates nothing.

## Dev servers

`astro dev` **detaches into the background** when it detects an AI coding agent, so it survives the
shell that started it. Stop it with `pnpm --filter admin exec astro dev stop`, not by killing the
foreground process. Playwright sets `ASTRO_DEV_BACKGROUND=0` for the same reason.

Each app pins its own `inspectorPort` (env-overridable), because an explicit port loses wrangler's
automatic fallback and both apps would otherwise fight over 9229.

`apps/admin` delays dev startup by 2.5s. Both apps recovering the shared WAL at once kills one of
them; letting `apps/public` go first avoids it.

Builds need `NODE_OPTIONS=--dns-result-order=ipv4first` — Node resolves `localhost` to `::1` while
the prerender fetch listens on `127.0.0.1`. It is set both in `devcontainer.json` and in each
app's `build` script, so CI works too.

## Architecture

```
apps/public   main domain: catalog, applications, news, member login, cart and orders
apps/admin    subdomain: screening, organizations, orders, inquiries, audit log
              (shadcn-svelte lives here only; no content management — D-017)
packages/schema      Drizzle tables, ULID, D1 client
packages/server-kit  password hashing, lockout, session rules, HTTP envelope,
                     outbound-integration retry and structured logging
                     (only apps/public uses the auth half now — D-022)
packages/content     developer-maintained Markdown: products, manufacturers, brands,
                     prices, news, diagnosis
```

Layering inside an app is `pages/ → services/ → schema`. API routes parse input with Zod, call a
service, and convert thrown `AppError`s with `toErrorResponse`. Content Collections bypass this —
pages read them directly through `lib/catalog.ts`, because the service layer is the D1-and-authz
boundary and build-time data sits outside it.

Pages guard themselves — unlike an API route a page redirects instead of answering 401. **`apps/admin`
is the exception**: its `middleware.ts` verifies the Access JWT for every route, because every route
there is privileged and one missed page is a hole (D-022).

The placement rule is "who updates it": the operator updates it → D1 with an admin screen; a
developer updates it → `packages/content` or a constant. In this project the answer came out
"developer" for **all** public content, which is why there is no CMS (DEV-06 §1-1 is the source of
truth).

## Authentication

**The two sides no longer share a mechanism.** `apps/admin` is behind Cloudflare Access and has no
login page, no session table and no password (D-022); `apps/public` keeps D1 sessions for members.
The rule to hold onto is therefore not "keep them separate" but **never reintroduce an app-level
login to `apps/admin`** — two doors into the admin means the strictest Access policy can be walked
around.

For `apps/admin`:

- `middleware.ts` resolves the identity and hands it down through `Astro.locals`. Handlers must not
  read `Cf-Access-Jwt-Assertion` themselves. Two paths, in order (D-029):
  1. `Astro.locals.cfContext.access` → `getIdentity()`. No JWT parsing, per Cloudflare's guidance.
  2. The header, verified against the team JWKS and the **AUD tag**, with `alg` pinned to RS256.
     **This is the path production actually runs**: a Worker serving static assets sits behind an
     internal router that does not pass `ctx.access` through, and Astro's adapter always configures
     assets. Do not delete it as dead code.
- Neither available means 403. An identity with no email (a service token) is refused too — an audit
  entry needs someone to attribute.
- Local dev and e2e get their identity from `wrangler.jsonc`'s `access.dev` block, which a deployed
  Worker never receives. There is no env-var bypass; don't add one.
- `admin_users.status = inactive` is refused even with a valid identity. It is the second lock for
  when someone is removed from the Access policy but not from the ledger.

For `apps/public`, two rules that look like implementation details but are not:

- Miss paths (`unknown email`, `deactivated`) still run `burnPasswordVerification`. Returning early
  makes them answer far faster than a real account, which is a usable enumeration oracle.
- A missing `SESSION_TTL_DAYS` or `AUTH_LOCKOUT_*` var must throw. `Number(undefined)` is `NaN`,
  every comparison against it is false, and the lockout would silently never engage.

`apps/public` sets `Cache-Control: private, no-store` on member routes **in middleware**, not in
page frontmatter: `Astro.response.headers` does not reach a `Response` returned from a page, so
redirects would go out cacheable. The admin subdomain needs no equivalent.

Lockout counts per IP as well as per account, and locally every request arrives from `127.0.0.1` —
so five failed attempts lock every account for 15 minutes, and the symptom is a 429 on a password
that is correct. The KV binding lives in `apps/public`, but clear it from `apps/admin`, where both
the binary and the relative path resolve:

```bash
npx wrangler kv key list --binding KV --local --persist-to ../../.wrangler-state
npx wrangler kv key delete "auth-lock:ip:127.0.0.1" --binding KV --local --persist-to ../../.wrangler-state
```

## Testing

Unit tests run inside workerd via `@cloudflare/vitest-plugin`, not Node — `hashPassword` needs Web
Crypto and lockout needs a real KV. It peers on `vitest ^4.1.0`; vitest 5 makes miniflare fail to
boot with a bare `SyntaxError`.

E2E seeds its own **member** account in `globalSetup`, so no env vars are needed; the admin suite
gets its identity from `wrangler.jsonc`'s `access.dev` block, since Playwright cannot pass Access —
the ledger row is provisioned on the first request. `pnpm test:e2e`
runs with `--concurrency=1`: both suites drive a real dev server against the one local D1, and
running them in parallel corrupts it. **Each suite is also `workers: 1` inside Playwright**, for the
same reason one level down — every test shares that one D1 and the single seeded member, so a
parallel logout deletes the session a login is still using. The symptom is a login test that passes
alone and fails in the suite; raising either number brings it back.

Product and news fixtures are the **real** `packages/content` files, not a test-only collection —
schema violations are supposed to fail the build, and a separate fixture set would route around that
check.

Cover what E2E cannot reach — fail-closed config (including the Access fallback), expiry, timing
parity, price resolution, and the fact that no other organization's price reaches a response — in
Vitest. Cover hydration in E2E: a missing `client:*` directive still renders server-side, so only an
interaction catches it. The e2e assertion that an anonymous visitor sees no wholesale price also
catches an accidental `prerender = true` (D-021).

## MCP servers

Configured in `.mcp.json`, enabled in `.claude/settings.json`.

- `context7` — library/framework docs
- `astro-docs`, `svelte`, `cloudflare-docs` — the official docs servers for this stack. Prefer
  them over `context7` for those three
- `context-mode` — context compression
- `semble` — code search (needs `uv`)
- `playwright` — browser automation. `--browser chromium` is required: the default is branded
  Chrome, which is not installed. `--output-dir` only applies when no filename is given, so asking
  for a named screenshot writes it to the repo root.

## Skills

`.claude/skills/shadcn-svelte/` is vendored verbatim from `huntabyte/shadcn-svelte`
(`skills/shadcn-svelte/`). Never hand-edit it — refresh by replacing the directory. The rest are
this team's own.

`shadcn-svelte` components are added with `npx shadcn-svelte add <component>` from inside
`apps/admin`. The CLI writes tab-indented files, so run `pnpm format` afterwards.

## Editing files

Always create/modify files with the `Edit` / `Write` tools, never `Bash` (`sed`, `echo >`,
heredocs). The PostToolUse hook (`.claude/hooks/format-and-check.sh`) only fires on `Edit`/`Write`
— bypassing it silently skips Prettier, ESLint, and the typecheck that runs after them.

## Committing

**Never run `git commit` without asking first — every single time.** Finishing a task is not
approval to commit it, and neither is approval of the previous commit. Say what would go in,
offer the message, and wait for an explicit yes. Messages are one line.

An unasked commit is the one mistake that re-running the tool cannot undo. `permissions.ask` in
`.claude/settings.json` carries `Bash(git commit:*)` so the prompt also appears — but that is a
second pair of eyes, not the rule. Ask in prose first.

## Comments

**Comments are written in English, without exception.** Everything the user reads — UI copy, error
messages, `lib/*.ts` label constants, Markdown in `packages/content` — stays Japanese; the code
that surrounds it does not. Mixed-language comments make a file impossible to skim and diff
reviews unreadable, and the surrounding code is already English.

Write the code first with no comments, then add back only the ones that survive this test:

**Name the specific mistake the comment prevents. If you cannot name one, delete it.**

"A reader might wonder why" is not a mistake. "Someone will reorder these two calls and orphan a
row" is. Apply it per comment, not per file.

Then:

- **One line.** A second line only to name the consequence. Never a paragraph.
- **State the constraint, not the reasoning that produced it.** `// Bucket first: a row must never
  point at missing bytes.` — not the paragraph about which failure mode is recoverable. The
  reasoning belongs in the commit message, or in `docs/` if it outlives the commit.
- **Say it once per file.** The second and third place cross-reference the first.
- **"Not X" only when someone would plausibly write X.** Ruling out an option nobody would reach
  for is noise.

If comment lines exceed roughly a tenth of a file, that is not a violation but it is a signal —
read them again with the test above.
