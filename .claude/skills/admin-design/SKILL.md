---
name: admin-design
description: Build or rework ADMIN screens (dashboards, lists, forms, settings) using shadcn-svelte, following the project's existing component patterns, then verify with fixing-accessibility and design-review. Use when implementing an admin/dashboard screen under apps/admin/src/pages. NOT for public-facing pages — use the public-design skill for those.
---

# Admin Screen Design

Build an admin screen by following the project's existing shadcn-svelte patterns — admin
design is decided by shadcn-svelte components and `admin.css`'s design tokens, not by per-page
aesthetic exploration. The goal is uniformity: every admin screen should feel like the same
product. Do NOT invoke `frontend-design` or seek a distinctive visual direction here.

The argument to this skill is the screen brief (which screen, what data/actions it needs).

## Step 1 — Implement against the standard patterns

Invoke the `shadcn-svelte` skill before writing anything — it covers the CLI, this project's
`components.json` (aliases, `neutral` base color, `lucide` icons), and the composition/forms/
styling/icon rules under `.claude/skills/shadcn-svelte/rules/`. While implementing:

- Compose from the primitives already in `apps/admin/src/lib/components/ui/` first; only run
  `npx shadcn-svelte add <component>` (from inside `apps/admin`) for something genuinely
  missing. Per CLAUDE.md: never hand-edit `.claude/skills/shadcn-svelte/`, and run
  `pnpm run format` after `add`/`update` since the CLI's own output uses tabs.
- Look at the most similar existing admin screen for established composition style before
  inventing a new layout. **The reference is ADM-01, `apps/admin/src/pages/index.astro`**, built
  with `apps/admin/src/layouts/Layout.astro`. What it establishes:
  - The shell: the nav lives in `Layout.astro` as server-rendered markup with `aria-current`,
    **not** shadcn-svelte's `Sidebar`. Sidebar is a Svelte provider tree, and using it in Astro
    would mean putting whole pages inside an island — which also drags server-resolved data into
    the client payload (D-021). Every screen wraps its content in the same
    `mx-auto w-full max-w-7xl px-5 py-8 sm:px-8` container and gives itself a real `<h1>`
  - Full `Card.Root` > `Card.Header`/`Card.Title`/`Card.Description`/`Card.Action`/`Card.Content`
    composition, `Table.Root` with an `sr-only` `Table.Caption` for lists, and `Empty.Root` for
    the nothing-to-show state — never hand-rolled markup for any of the three
  - Dates and amounts go through `apps/admin/src/lib/format.ts`. Workers run in UTC, so a raw
    `created_at` renders nine hours off for the operator
  - There is no login screen and no logout control anywhere (Cloudflare Access — D-022)

  For forms, follow `.claude/skills/shadcn-svelte/rules/forms.md`: `Field.FieldGroup` >
  `Field.Field` > `Field.FieldLabel` + control + `Field.FieldError`, never a bare `div` with
  `grid gap-*`. An island that posts to an API renders per-field errors from the 422 envelope,
  a `role="alert"` message for everything else, and keeps its submit disabled until `onMount`
  fires — a submit before hydration is a native POST that loses the input. As more screens land,
  treat the most recent screen of the same kind (list/detail/form) as the reference.
- Wrap the page in `apps/admin/src/layouts/Layout.astro` (which imports
  `apps/admin/src/styles/admin.css`) — never `apps/public`'s layout or `global.css`.
- Styling stays within `admin.css`'s CSS-variable tokens (`--primary`, `--muted-foreground`,
  etc.) — no per-screen color/typography decisions. If something looks off product-wide, fix
  the token in `admin.css`, not the page.

Done when the screen renders end-to-end with realistic data.

## Step 2 — Consistency & polish pass

Sweep the screen you just built:

- Compare spacing/typography against the most similar existing admin screen, not against
  taste.
- Confirm each control came from `apps/admin/src/lib/components/ui/` (or a freshly-added
  shadcn-svelte component) rather than hand-rolled markup duplicating what a primitive already
  does.
- Empty/loading/error states are present and each surfaces one clear action.
- Invoke the `baseline-ui` skill for the generic sweep (spacing, hierarchy, small layout
  issues). Skip its design-direction concerns — `admin.css`'s tokens already decide those.

## Step 3 — Accessibility pass: `fixing-accessibility`

Invoke the `fixing-accessibility` skill and audit/fix the screen. shadcn-svelte's primitives
(built on `bits-ui`) already cover most primitive-level behavior (focus trap, ARIA roles) —
focus the audit on what the page composes: heading order (the login screen has no `<h1>` at all
today — give every screen you build a real one, visible or `sr-only`, rather than copying that
gap), form error associations, icon-only buttons, table semantics, focus after dialog/sheet
close.

## Step 4 — Verify in a real browser: `design-review`

Invoke the `design-review` skill for the finished screen. Pay particular attention to its
consistency findings (does this screen look like the rest of the admin?) and the responsive
behavior of tables/filters/forms at the mobile breakpoint.

## Feedback loop

Fix findings by returning to the step that owns them (pattern/composition → Step 1, polish →
Step 2, a11y → Step 3), then re-run Step 4. Max 2 loops without checking in with the user.

## Reporting

Summarize in the user's language: which existing screen you used as the pattern reference,
what was built, and the a11y/review results (reference the screenshots).
