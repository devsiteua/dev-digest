# DevDigest profile — how the rules land in this repository

> Written from a reading of `client/` on the `lesson-02` branch. The dialect below is stable; the
> smells at the end are what was true at the time of writing. **Verify with grep before acting on
> any of them** — several may already be fixed, and a stale claim is worse than no claim.

## Contents

- Source of truth
- Rule-by-rule mapping
- Two places where the repo's own documents disagree
- Constraints you cannot design around
- Structural smells to check for

## Source of truth

Do not restate the conventions here; read them where they live, then use this file for the
reasoning and the gaps.

| Document | Authority over |
|---|---|
| `client/CLAUDE.md` | the map, the conventions, the gotchas — loaded automatically when working in `client/` |
| `client/docs/component-anatomy.md` | the recipes: adding a component, a data hook, a screen |
| `client/INSIGHTS.md` | what earlier sessions learned the hard way |
| `client/src/vendor/ui/README.md` | how the design system is consumed |

This skill's job is the *why* and the parts those files do not cover.

## Rule-by-rule mapping

| Rule | In this repository |
|---|---|
| 1 — one organising axis | Layout **A**, route-colocated. The `app/` tree is the feature tree; feature code sits in `_components/<Name>/` beside its route. There is no `src/features/`, and adding one would create the second axis rule 1 forbids. |
| 2 — rule of two | `src/components/` is the promotion target for cross-route chrome. The rationale is written into the code at `client/src/lib/findings.ts`: a formatter moved up only once a second surface, one directory away, needed it. |
| 3 — barrels | Per-component `index.ts` only. There is deliberately no `components/index.ts`. |
| 4 — utils vs helpers | Two tiers: colocated `helpers.ts` for one component's pure functions, `src/lib/*.ts` for anything two route subtrees share. The `lib` files carry unit tests; the colocated ones usually do not. |
| 5 — constants | Colocated `constants.ts` per component; design tokens in `vendor/ui/primitives/tokens.ts`; navigation in `vendor/ui/nav.ts`. |
| 6 — types | Types come from `@devdigest/shared` through the `src/lib/types.ts` shim, never hand-written. UI-only view models are declared in that shim too. |
| 7 — three layers | The strictest seam in the codebase: `lib/api.ts` → `lib/hooks/*` → components. Verified: the only `fetch(` in `client/src` is inside `lib/api.ts`. |
| 8 — state ownership | Server state in TanStack Query; tabs, filters, sort and open drawers in URL search params; client state in three contexts (`repo-context`, `theme`, `toast`). In-flight run state is read back from the server so it survives a reload — see `client/CLAUDE.md`. |
| 9 — import direction | Not enforced: **the repository has no linter at all.** The only machine-checked boundaries are `tsconfig` path aliases and Next's `_`-prefix routing exclusion. |
| 10 — client boundary | Stated as "boundaries at the page level" — which agrees with the general rule here, because pages are what call hooks. See the reconciliation below. |
| 11 — one styling mechanism | Inline style objects from `styles.ts`, keyed to CSS custom properties, themed by `data-theme`. Stated explicitly: *"Do not introduce a second styling mechanism."* Tailwind is installed but is not the styling mechanism. |
| 12 — tests and copy | Component tests colocated as `<Name>.test.tsx`; browser journeys in the separate `e2e/` package; copy in `messages/<locale>/` via next-intl. |
| 13 — loading/error boundaries | **Absent.** There is no `loading.tsx`, `error.tsx` or `not-found.tsx` anywhere in `app/`; the root layout has a single `<Suspense fallback={null}>`. Loading and error states are handled per screen with `Skeleton` / `ErrorState` instead. Treat this as a deliberate current state, not as an example to copy. |

## Two places where the repo's own documents disagree

Both are real, both are load-bearing, and neither should be resolved silently.

### The component folder: mandatory six files, or mandatory two?

- `client/CLAUDE.md` presents the six-file folder (`<Name>.tsx · styles.ts · constants.ts ·
  helpers.ts · index.ts · <Name>.test.tsx`) and adds: *"Verbose, but identical across every screen —
  follow it rather than inventing a shorter one."*
- `client/docs/component-anatomy.md` says the opposite: *"Only `<Name>.tsx` and `index.ts` are
  mandatory; add the others as soon as the corresponding content appears."*

**Follow `component-anatomy.md`** — it is the more specific document, it is the one `client/CLAUDE.md`
points to for this task, and its rule is the one that produces the tree that actually exists.
`CLAUDE.md`'s sentence is best read as "do not invent a *different* shape", not "create six files
whatever the content".

The practical consequence: component folders without a `styles.ts` are not automatically wrong.
They are wrong only when the component has styles and keeps them inline anyway — which is the smell
the shorter rule already names ("rather than letting inline styles or magic numbers accumulate").

### The client boundary: "page level" or "highest node that needs it"?

`client/CLAUDE.md` says *"keep server/client boundaries at the page level rather than sprinkling
`use client` through leaf components"*; this skill's rule 10 says "the highest node that actually
needs it".

They agree **here**, because a page that calls hooks is that node. State it as one rule when
working in this repo: the directive goes on the page, and nothing below it repeats it. The general
rule matters only for the case the repo has not hit yet — a server page rendering an interactive
island, where the boundary belongs on the island, not on the page.

## Constraints you cannot design around

- **`src/vendor/ui/**` is off-limits** for casual edits (root `CLAUDE.md`, "Do not touch"). Import
  everything through `@devdigest/ui`; never reach into a layer file by path. A missing primitive is
  a conversation, not a local patch.
- **`src/vendor/shared/` is a copy** of the server's Zod contracts. Contract edits are made in both
  trees, and the two have already drifted once.
- **The client may import only *types* from the shared package.** Importing a runtime value pulls
  `vendor/shared/index.ts` into the bundle, and its `./contracts/*.js` re-exports do not resolve
  under Next's bundler. This is why `lib/feature-models.ts` hand-mirrors a registry that exists on
  the server — a deliberate duplication, documented at the site. Any new shared *value* faces the
  same wall.
- **There is no linter.** Everything in [enforcement.md](enforcement.md) is a proposal here, not a
  description. Three `eslint-disable` comments in the tree point at a rule nothing runs.

## Structural smells to check for

Not a list of known bugs — a list of things to look at before adding to the file you are in. Each
one exists somewhere in the tree; grep to find out whether it still does.

- **Mixed import styles.** Both the `@/` alias and deep relative paths are in use, sometimes in the
  same import block. Check what the neighbouring lines do before adding one. Deep relative chains
  are also a placement signal — a file reached through five `../` is usually in the wrong folder.
- **Fat pages.** The pattern that works is a thin `page.tsx` delegating to a `<XView>` component
  (`agents/`, `settings/` do this in a handful of lines). Some pages instead hold filtering,
  sorting, tab routing, derivations and cache invalidation directly. When editing one, move the new
  logic into a component rather than adding to the page.
- **`useQueryClient()` in a page.** Cache invalidation belongs in the mutation that causes it, in
  `lib/hooks/`, not hand-rolled in a screen.
- **Inline query keys.** Keys are written as literal arrays at every read and every invalidation,
  with no registry. Before adding a key, check every place the same domain string already appears;
  a typo here fails silently at runtime.
- **Component folder without `styles.ts` but with inline style objects.** That is the actual
  violation — see the reconciliation above.
- **Barrel spelling.** At least four spellings of the one-line re-export coexist, so callers cannot
  predict default vs named import. Match the folder you are in; do not introduce a fifth.
- **Folder case.** `app/**/_components/` uses PascalCase, `src/components/` uses kebab-case. Both
  are established; use whichever the branch you are in already uses.
- **Redundant `'use client'`.** Most directives sit on leaves already inside a client subtree.
  Adding another is noise. The inverse is the real hazard: `vendor/ui` uses hooks throughout and
  carries **no** directive anywhere, so the first server component that renders one of its
  components will fail the build.
- **Hardcoded English.** next-intl adoption is partial; several screens still ship literal strings,
  including in `window.confirm` calls. New copy goes through `messages/`.
- **Undocumented mirrors.** Registries hand-copied from the server exist in more than one file, and
  not all of them say why. If you add one, say why at the site.
- **Stale pointers.** Some comments and READMEs reference files and routes that do not exist. Treat
  prose as a hypothesis and verify against the code — the repo's own `INSIGHTS.md` records this as a
  recurring cost.
