---
name: scaffold
description: Build the Service + Zod validation + API Route set for one or more resources whose tables already exist, by following the inquiry reference implementation. Use when asked to add CRUD, a listing, or a state machine for a table in packages/schema/src/schema.ts. NOT for the table itself — run schema-build first if it does not exist yet. NOT for admin/public page UI — that is admin-design/public-design.
---

# Scaffold

Turns tables into the Service/validation/API-Route set the rest of the project already follows.
There is no generator: **`inquiries` is the reference implementation**, and a new resource is that
shape applied to a different table.

- `apps/admin/src/lib/server/services/inquiries.ts` — list, get, delete, state transition
- `apps/admin/src/pages/api/v1/inquiries/{index.ts,[id].ts,[id]/{start,reopen,resolve}.ts}`
- `apps/public/src/lib/server/{services,validation}/inquiries.ts` — the unauthenticated create
- `apps/admin/tests/unit/inquiries.test.ts` — what the conventions are, expressed as assertions

Read those before writing anything. Scope: this skill owns `services/`, `validation/` and
`pages/api/` inside an app. It does not touch `packages/schema` (that is `schema-build`) or any
screen (that is `admin-design` / `public-design`).

**Do several resources in one run.** Decide the answers below for every resource first, then write
them one after another — there is no reason to stop between them.

## Step 1 — Decide, per resource

Read the table in `packages/schema/src/schema.ts`. Where `docs/` exists, DEV-07 defines the
columns and DEV-09 the state machine; without it, the table and the request are the input.

| Decision | How to settle it |
| --- | --- |
| External key | `publicId` if the table has one, otherwise its natural unique key (`provider_event_id` on `payment_event_logs`). Never the integer `id` |
| Which app | Who performs the operation. A visitor writing means it belongs in `apps/public`; an operator reading or handling it belongs in `apps/admin`. Both may touch the same table — they share a D1 and must not import each other |
| Client-writable columns | Everything except the key, `status`, the timestamps, and anything the server sets from the session |
| Operations | Not every resource gets full CRUD. Ask what a person actually does with it: nobody edits what a visitor submitted, and a lookup table rarely needs a state machine |
| Authorization | `apps/admin`: `requireAdminUser(context)` and nothing more — AdminUser has no role column (D-014), so a generated role branch is wrong and gets deleted. `apps/public`: the Member session plus `requireActiveOrganization`, and every order-related query carries `WHERE organization_id = ?` |
| Transitions | The legal `from -> to` moves, and for each: does it have a side effect? (`start` assigning the handler is one) |

## Step 2 — Write it

Follow the reference file for file. The conventions that matter, in the order they usually break:

- **The internal integer id never leaves the service.** `toPublicX` maps `publicId` to `id` and
  drops every internal FK. Re-expose an FK only as the referenced row's public key
- **One writer for `status`.** A single `transitionX` validates the move against a `TRANSITIONS`
  map and throws `InvalidStateTransitionError`; nothing else assigns it
- **The audit entry goes in the same `db.batch()` as the change**, so a rejected or failed change
  leaves no log of itself. Log deletions too, with enough in `properties` to identify the row once
  it is gone
- **Validation is derived from the table** with `drizzle-zod` and `.pick()`ed down to the writable
  columns — a field the server owns must be impossible to send
- **Lists are keyset-paginated**, `perPage` clamped, `nextId` opaqued by the route with
  `encodeCursor`. Never offset
- **Routes parse and respond, nothing else.** `requireAdminUser(context)` → service call →
  `jsonItem` / `jsonCursorCollection`, with `ZodError` converted to `ValidationError`. The db
  handle comes from `context.locals.db`, which middleware.ts set alongside the verified Access
  identity — a route must not read `Cf-Access-Jwt-Assertion` itself (D-022)
- **One route per transition** (`POST /{id}/start`), not a `PATCH` on `status`

## Step 3 — The parts no pattern can supply

These are where a new resource actually differs from the reference. Work through each:

- **Identity-derived fields** — `assigneeId`, `reviewerId` and the like come from the AdminUser
  `requireAdminUser` returned (or the Member session), never the request body
- **Transition side effects** — a move that also assigns, clears or stamps a column
- **Refinements** — lengths, formats and bounds the column type does not express
- **Internal FK columns in the response** — map them to the referenced row's public key or drop
  them; passing an integer through is the default mistake
- **Join rows** — D1 enforces foreign keys, so a delete removes the join rows first, batched
- **References into packages/content** — `product_slug` and the price files' `org_code` have no
  foreign key to lean on (D-017・D-019). Resolve them in the service and fail loudly when they do
  not resolve; for orders, snapshot the resolved name and price onto the row (DEV-07 §6-0)
- **Unauthenticated routes** — a public write is open by definition; say so in a comment and leave
  abuse handling to the edge

## Step 4 — Verify

If the resource uses a binding the app's tests have not needed before, add it to the app's
`vitest.config.ts` (`d1Databases`, and `kvNamespaces` in `apps/public`) — otherwise every test
file in that app fails to boot, not just the new one. There is no R2 binding in either app
(D-020) and no KV in `apps/admin` (D-022); needing one is a decision, not a config tweak.

```bash
pnpm check          # format, lint (layer boundaries), typecheck, unit tests
```

Then, for each resource:

1. **Write the unit tests.** The reference's test file is the checklist: the public shape hides
   internal integers, validation drops server-owned columns, paging clamps and terminates,
   illegal transitions throw and leave no audit entry, missing rows throw `NotFoundError`
2. **`apps/public`: add every new member-only route to the e2e redirect list.** That app has no
   auth middleware, so a route that forgets its session check is simply open, and the e2e test is
   the only place the omission surfaces. `apps/admin` needs no equivalent — `middleware.ts`
   covers every route there (D-022) — but a new route still calls `requireAdminUser` for the
   ledger row and the `inactive` refusal
3. `pnpm test:e2e`

## Reporting

List the files written per resource, and state which Step 3 decisions you made and why — those
are the ones a reviewer needs to check. Call out anything you left for the caller rather than
guessing at it.
