---
name: frontend-architecture
description: "Decides where frontend code belongs — component placement and splitting, colocation vs shared folders, constants, utils vs helpers, types, styles, tests, where business logic and data access live, and Server/Client Component boundaries in the Next.js App Router. Use when creating a new component, hook, route or module; when deciding what to extract and where to put it; when reviewing or refactoring folder structure and import boundaries. Trigger terms: architecture, folder structure, project structure, where to put, colocation, feature folder, barrel file, layering, separation of concerns, server component boundary."
version: 1.0.0
---

# Frontend Architecture

Answers **placement** questions in a React / Next.js codebase: where a file goes, when to split
one, which layer owns which logic, and where the server/client boundary sits.

Placement only. Code quality inside a component is a different skill — see [Out of scope](#out-of-scope).

## How to use

1. Match the question to a rule below.
2. Apply the rule. Each one states its ✓ and ✗ so the answer is decidable, not a preference.
3. Open a reference file only when you need the rationale, the trade-off, or a worked example.
4. **Working in this repository: read [references/devdigest-profile.md](references/devdigest-profile.md)
   before creating any file.** The local dialect overrides the defaults below where they differ,
   and it records two places where the repo's own docs disagree with each other.

## Placement rules

### 1. One organising axis, not two

Pick how the tree is organised — by route, by feature, or by layer — and do not run a second axis
in parallel. When the framework already imposes a hierarchy (the Next.js `app/` tree), that is the
default axis: feature code lives beside the route that owns it.

- ✓ `app/orders/[id]/_components/OrderTimeline/` — the route tree *is* the feature tree
- ✓ `src/features/orders/` — valid when routing is thin or absent (SPA, library, multi-app repo)
- ✗ `src/features/orders/` **and** `app/orders/` both holding order UI — two axes, and no rule
  says which one a new file belongs to

The three canonical layouts and where each breaks: [references/file-layout.md](references/file-layout.md)

### 2. The rule of two

Code moves to a shared folder when a **second** consumer from another branch of the tree appears.
Not before. One consumer plus a hunch is a premature abstraction.

- ✓ used by one screen → colocated with that screen
- ✓ a second screen needs it → promote, and leave a comment saying which two now share it
- ✗ `shared/utils/` created for something with a single caller

### 3. Barrels: per component, never per folder

A component folder may re-export itself through `index.ts`. A folder-wide barrel that re-exports
everything underneath must not exist.

- ✓ `Button/index.ts` → `export { Button } from "./Button"`
- ✗ `components/index.ts` re-exporting 50 components — inflates the module graph, defeats tree
  shaking, and a single `'use client'` inside spreads to every consumer of the barrel
- Use one spelling for the re-export across the codebase; four spellings of the same line is a
  smell that nobody owns the convention

### 4. `utils` and `helpers` are different things

A **utility** is generic and would survive being copied into another project. A **helper** is
specific to this product and usually to one component.

- ✓ `helpers.ts` beside the component — pure functions over that component's props
- ✓ `lib/` or `utils/` — generic, reusable, unit-tested
- ✗ a `utils/` dump that accumulates one-caller functions; when the component is deleted they stay
  behind forever

### 5. A magic string with two readers becomes a named export

Values that two or more modules must agree on — query keys, route paths, search-param names,
status enums, feature flags — live in one registry and are imported. Thresholds and maps used by a
single component stay in its colocated `constants.ts`.

- ✓ `queryKeys.orders(repoId)` imported by the hook and by the code that invalidates it
- ✗ `["orders", repoId]` typed out in three files that must stay in sync by memory

### 6. Types: inline → colocated → shared

Promote a type only when a second module needs it, exactly like rule 2.

- ✓ props typed inline in the component file
- ✓ `.types.ts` beside the folder once two files in it share a type
- ✗ a global `types/` folder holding domain models — that folder is for ambient declarations and
  re-exported contracts, nothing else

### 7. Logic in three layers

Pure functions (business rules, testable with no React) → hooks (application logic: fetching,
caching, subscriptions, wiring) → components (render and event handling).

- ✓ sorting/derivation rules as exported pure functions, called from a hook or the component
- ✓ every network call behind a hook or a data-access function
- ✗ `fetch(...)` in a component body
- ✗ business rules embedded in JSX, where they cannot be tested without rendering

Worked example: [references/logic-layers.md](references/logic-layers.md)

### 8. State goes where its owner is

Ask who owns the value, then place it:

| Owner | Home |
|---|---|
| The server | a query/cache library — never mirrored into a client store |
| The URL (shareable, survives reload: tabs, filters, pagination) | search params |
| One subtree | local state, lifted only as far as the closest common parent |
| Cross-cutting dependency (theme, auth, toasts) | context — as **dependency injection**, not a store |

- ✗ copying an API response into a global store and hand-tracking loading/error flags

### 9. Imports flow one way

`shared → features → app`. Shared code never imports feature code; features never import each
other directly — they meet in shared.

- ✗ `features/billing` importing from `features/orders`
- ✗ a design-system file importing an application constant

Make it machine-checked, not review-checked: [references/enforcement.md](references/enforcement.md)

### 10. The client boundary sits at the highest node that needs it

Server by default. `'use client'` marks a boundary in the module graph: everything the marked file
imports is pulled to the client with it.

- ✓ one directive on the interactive subtree's root
- ✓ server components passed **as `children`/props** into a client component stay on the server
- ✗ the directive repeated on leaves already inside a client subtree — noise that hides where the
  real boundary is
- ✗ a shared UI package whose components use hooks but carry no directive — it only builds while
  no server component imports it

### 11. One styling mechanism

Whatever the project uses, it uses one. Style definitions sit beside the component; design tokens
(colour, spacing, elevation) live in the design system, not restated per component.

- ✗ a second mechanism introduced "just for this screen"

### 12. Tests beside the subject, copy in the translation files

- ✓ unit and component tests colocated with what they test
- ✓ end-to-end tests in their own package — they outlive any restructuring of `src/`
- ✗ user-facing strings hardcoded in JSX when the project has a translation layer

### 13. Loading and error boundaries are placement decisions

In the App Router, `loading.tsx` / `error.tsx` / `not-found.tsx` belong to the segment whose UI
they cover.

- ✓ a boundary on the slow segment, so the rest of the page stays interactive
- ✗ a single `<Suspense>` at the application root — that is an unplanned boundary, not a design

App Router specifics, and the three data-handling models (HTTP APIs / Data Access Layer /
component-level access): [references/nextjs-app-router.md](references/nextjs-app-router.md)

## When to split a component

Structural signals, not line counts: branching that changes what the component *is*, more than
about seven props, two sets of state that never change together, or a name that needs "and" in it.

Signals, composition patterns, and why container/presentational is now a consequence of the
server/client boundary rather than a folder convention:
[references/component-boundaries.md](references/component-boundaries.md)

## Out of scope

| Question | Skill |
|---|---|
| Anti-patterns inside a component: derived state, `useEffect` misuse, memoisation, keys, a11y | `react-best-practices` |
| Next.js APIs, metadata, image/font handling, bundling | `next-best-practices` |
| How to write the test once you know where it goes | `react-testing-library` |
| Schema design and validation | `zod` |

Performance is deliberately excluded. Where a rule here has a performance side effect (barrels,
client boundaries), the reason given is still architectural.

## References

| File | What it covers |
|---|---|
| [references/file-layout.md](references/file-layout.md) | Rules 1–6, 11, 12 — what goes where, three canonical layouts, naming, import paths, the promotion rule |
| [references/component-boundaries.md](references/component-boundaries.md) | When to split, composition over configuration, slots, the container/presentational question |
| [references/logic-layers.md](references/logic-layers.md) | Rules 7–8 — one feature split across the three layers, API client placement, key registries, invalidation |
| [references/nextjs-app-router.md](references/nextjs-app-router.md) | Rules 10, 13 — colocation and private folders, route groups, the three data-handling models, DTOs, `server-only`, server actions |
| [references/enforcement.md](references/enforcement.md) | Rule 9 — lint configuration that makes these rules fail the build instead of the review |
| [references/devdigest-profile.md](references/devdigest-profile.md) | How every rule above maps onto this repository, plus the structural smells to check for |

Sources for every rule are listed in [README.md](README.md).
