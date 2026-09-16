# ペット漢方 卸売サイト

A B2B wholesale site for pet Kampo supplements — Astro SSR on Cloudflare Workers, in a Dev
Container. Retailers apply, the operator screens them, and approved organizations see wholesale
prices and place orders.

`apps/public` is the main domain and `apps/admin` a subdomain of the same service — separate Workers
sharing **one D1** and the schema in `packages/schema`. There is no R2 bucket.

Public content (products, manufacturers, brands, per-organization prices, news, diagnosis rules)
lives in `packages/content` as Markdown, not in the database, so **there is no content management
screen**: publishing is a deploy. D1 holds transactional data only.

- **Implementation rules**: `CLAUDE.md`
- **Specifications**: `docs/` (25 documents; `docs/00_README.md` first)
- **Why things are the way they are**: `docs/5-governance/01-decision-log.md` (D-001〜D-024)

## Prerequisites

- Docker (e.g. Docker Desktop)
- VS Code + the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers),
  or GitHub Codespaces
- A Cloudflare account. Member password hashing costs ~50ms of CPU, which the Workers Free plan's
  10ms limit cannot fit at any secure iteration count — **this assumes a paid Worker**
- Cloudflare Zero Trust (Access) enabled on the account — it is what authenticates the admin app

## Setting up

Steps 1–2 are host-side; the rest run inside the container. **Step 4 must happen before step 8** —
after the first `pnpm db:generate` the migration contains those tables and removing them is no
longer a deletion. `migrations/` has not been generated yet, so step 4 is still open.

### 1. Container identity and ports — `.devcontainer/`

Edit `.devcontainer/.env`:

- `COMPOSE_PROJECT_NAME` — unique per project. docker compose prefixes containers, volumes and
  networks with it, which is also what keeps each project's `claude-config` volume separate
- `APP_PORT_DEV_PUBLIC` / `APP_PORT_DEV_ADMIN` — change so they don't collide with other projects
  running side by side

Then `.devcontainer/devcontainer.json`: `name`. The ports need no edit there — docker compose and
both `astro.config.mjs` read them from `.env`. Add any OS packages the project needs to `.devcontainer/Dockerfile`.

### 2. Start the container and sign in to Claude Code

VS Code: **Dev Containers: Reopen in Container**. Or `docker compose -f
.devcontainer/docker-compose.yml up -d`.

`.devcontainer/setup.sh` runs on first start: `pnpm install`, the MCP servers, and Chromium for
Playwright. Claude Code's auth lives in a named volume rather than a host mount, so **each project
container needs its own login**:

```bash
claude
```

### 3. Project and Worker names

```bash
# Both are literal placeholders, not `replace-with-*` — grep will not find them
package.json                 "name": "app"
apps/public/wrangler.jsonc   "name": "public"
apps/admin/wrangler.jsonc    "name": "admin"
```

Rename the two Workers. The `name` field becomes the `workers.dev` subdomain and identifies the
Worker in the account, so `public` and `admin` will collide with every other project that left them
alone. Use something like `acme-public` / `acme-admin`.

The `@app/*` package scope stays as it is — renaming it means editing every import for no benefit.

### 4. Remove what this project does not use

The template ships features whole so they come out cleanly. For this project (see the table in
`CLAUDE.md`, and GOV-01 D-020 / D-022):

- **File uploads** — delete `media`, the `BUCKET` binding in both apps, `r2Buckets` in
  `apps/admin/vitest.config.ts`, and admin's media service, validation, routes and tests
- **Admin login** — delete `admin_sessions`, `admin_users.password_hash`, admin's
  `lib/server/auth/`, `services/auth.ts`, `pages/api/v1/auth/`, `pages/index.astro`'s login form and
  the `login-form` / `logout-button` components; admin keeps no KV binding and no
  `SESSION_TTL_DAYS` / `AUTH_LOCKOUT_*` vars
- **`password_reset_tokens`** — repoint at `members` (admins have no password)

Member login, the contact form and Content Collections stay. Do this now, not after step 8.

### 5. Cloudflare resources

Create one of each, then copy the ids into **both** `wrangler.jsonc` files:

```bash
npx wrangler login
npx wrangler d1 create <db-name>
npx wrangler kv namespace create KV   # apps/public only — member lockout counters
```

`database_id` **must be identical in both apps** — it also keys the local sqlite file, so a
mismatch silently gives each app its own database. Replace every `replace-with-*` placeholder,
including the `staging` and `production` blocks (`vars`, `d1_databases` and `kv_namespaces` are
non-inheritable, which is why they repeat).

No R2 bucket is created — this project has no file uploads (D-020).

### 5b. Cloudflare Access for the admin app

The admin app has no login page; Cloudflare Access authenticates it (D-022). In Zero Trust:

1. Create an Access application covering the admin hostname, with a policy allowing the operator's
   email addresses
2. Add a **bypass** policy for `/api/v1/health*` only, so external monitoring does not get the login
   page
3. Copy the team domain and the application's **AUD tag** into `apps/admin`'s `wrangler.jsonc`
   (`CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`) — staging and production have different AUD tags

The Worker verifies the JWT itself as well, because a request sent straight to the `workers.dev` URL
never passes through Access. Locally, Access does not apply at all: set `DEV_ADMIN_EMAIL` in
`.dev.vars` and keep the test that proves it is inert in production (DEV-03 §3-5).

### 6. Custom domains

Neither `wrangler.jsonc` declares `routes`, so a deploy lands on `workers.dev` — fine for staging,
[not recommended for production](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).
Add the domain to each app's production block:

```jsonc
"routes": [{ "pattern": "example.com", "custom_domain": true }]
```

`custom_domain` means the Worker is the origin, and Cloudflare creates the DNS record and
certificate. A plain route instead puts the Worker in front of an existing origin and needs a
proxied DNS record you create yourself.

### 7. Secrets

`apps/*/.dev.vars.example` → `.dev.vars` (gitignored). Nothing is required by the code that ships
today. Non-secret configuration belongs in `wrangler.jsonc` `vars`; in staging and production the
same keys become Workers Secrets (`wrangler secret put`).

### 8. Schema, migration, first account

```bash
pnpm db:generate    # → packages/schema/migrations/ — commit this
pnpm db:migrate     # applies to the shared local D1
pnpm --filter admin seed -- --table=members --email=… --password=… --name=…
```

Admins are not seeded — the first Access-authenticated request creates the `admin_users` row (D-022).

`migrations/` is generated for this project, not shipped. If you ever delete it, delete
`.wrangler-state/` too — regenerating picks a new random filename and the next apply fails on
`table already exists`.

### 9. Verify

```bash
pnpm dev            # public on 5173, admin on 5174 by default
pnpm check          # format + lint + typecheck + unit tests
pnpm test:e2e       # needs pnpm db:generate first
```

Sign in to the public app at `http://localhost:<APP_PORT_DEV_PUBLIC>` (see step 1) with the account
from step 8. Use `localhost`, not the network URL the dev server prints — the session cookie is
`Secure`, and only `localhost` counts as a secure context over plain HTTP. The admin app at
`<APP_PORT_DEV_ADMIN>` has no login screen; locally it identifies you from `DEV_ADMIN_EMAIL`
(step 5b).

### 10. Repository

`dev` is the default branch and CI runs on it. Create `main` for production. The scaffold is still
in place — `apps/public/src/pages/index.astro` is a placeholder, and no screen from PRD-04 §3 has
been built yet.

## Day-to-day

| Command | |
| --- | --- |
| `pnpm dev` | Both apps. Stop with `pnpm --filter admin exec astro dev stop` — `astro dev` detaches when it detects an AI coding agent |
| `pnpm check` | format + lint + typecheck + unit tests |
| `pnpm test` / `pnpm test:e2e` | Vitest (inside workerd) / Playwright |
| `pnpm build` | |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle → migration SQL → local D1 |

Publishing content — a product change, a news post, a price revision — is a PR and a deploy, not an
admin action. Treat such requests as development tasks (OPS-02 §3-6).

`CLAUDE.md` has the rest, including the constraints that are not visible in the code.
