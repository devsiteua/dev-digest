# File layout — what goes where

## Contents

- Placement table
- The three canonical layouts, and where each one breaks
- The promotion rule
- Barrels
- `utils` vs `helpers` vs `lib`
- Constants and registries
- Types
- Styles, tests, copy, assets
- Naming
- Import paths

## Placement table

Start here. Each row is decidable without knowing the project.

| The thing | Where it goes |
|---|---|
| Component used by one screen | beside that screen |
| Component used by two screens in different branches | the shared components folder |
| Design-system primitive (Button, Card, Input) | the design system, imported through its public entry point |
| Pure function over one component's props | `helpers.ts` beside the component |
| Generic function that would survive being copied to another project | `lib/` or `utils/`, with a unit test |
| Threshold, sort weight, keyboard map used by one component | `constants.ts` beside the component |
| Value two modules must agree on (query key, route, param name, status) | a single exported registry |
| Type used in one file | inline in that file |
| Type shared by files in one folder | `.types.ts` in that folder |
| Domain type shared across the app | the contract package, or the feature that owns it |
| Ambient declarations, module augmentation | `types/` — and nothing else lives there |
| Network call | a hook or a data-access function, never a component |
| Business rule | an exported pure function |
| Component styles | beside the component |
| Design tokens | the design system |
| Unit / component test | beside its subject |
| End-to-end test | its own package |
| User-facing string | the translation files |
| Static asset used by one component | beside it; otherwise the public assets folder |

## The three canonical layouts, and where each one breaks

There is no universally correct layout. There is a correct layout *for a given amount of coupling*.
Pick one, write down which one, and do not run two at once (SKILL.md rule 1).

### A. Route-colocated

Feature code lives inside the route segment that owns it. The router's hierarchy is the only
hierarchy.

```
app/orders/
  page.tsx
  _components/OrderTable/
  _lib/order-filters.ts
app/orders/[id]/
  page.tsx
  _components/OrderTimeline/
```

- Works when: most features map onto exactly one route, and the framework gives you non-routable
  folders (Next.js `_private` folders, which opt a subtree out of routing entirely).
- Breaks when: a feature spans several unrelated routes. The code then either duplicates or gets
  promoted to a shared folder, and the shared folder slowly becomes the real home while the route
  tree keeps the leftovers.
- Source: [Next.js — project structure](https://nextjs.org/docs/app/getting-started/project-structure)
  lists "split by feature or route" as one of three supported strategies.

### B. Feature folders (bulletproof-react)

```
src/features/orders/
  api/  components/  hooks/  stores/  types/  utils/
src/components/   src/hooks/   src/lib/   src/utils/    # shared only
```

Each feature carries only the segments it needs. The critical part is not the folders — it is the
**dependency rule**: `shared → features → app`. Shared code may be used by anything; a feature may
import shared code; the app layer may import both; and one feature may never import another.

- Works when: features are the unit of ownership, and routing is thin.
- Breaks when: nobody enforces the dependency rule. Without a lint rule, cross-feature imports
  appear within weeks and the folders become decoration.
- Source: [bulletproof-react — project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md).

### C. Feature-Sliced Design

Layers (`app` → `pages` → `widgets` → `features` → `entities` → `shared`), each split into slices
(business domains), each split into segments (`ui`, `model`, `api`, `lib`, `config`). A module may
import only from layers strictly below it, and slices on the same layer may not import each other.

- Works when: the app is large enough that "which feature owns this?" is a real question with a
  real answer, and there are enough people that the ceremony pays for itself.
- Breaks when: applied to a small app. Six layers over twelve components is pure overhead, and the
  entity/feature distinction becomes a debate instead of a rule.
- Source: [Feature-Sliced Design](https://feature-sliced.design/docs/get-started/overview).

### The dissenting view, kept on purpose

Organising **by function** (`components/`, `hooks/`, `helpers/`, `utils.ts`, `constants.ts`) with a
per-component folder and an `index.ts` is a coherent, defended position —
[Josh Comeau's file structure](https://www.joshwcomeau.com/react/file-structure/). It optimises for
a legible editor and short imports rather than for feature isolation. It is the right choice for
small and mid-size apps by a single author; it degrades exactly where by-type layouts always
degrade — one small requirement touches files in many distant folders.

Do not blend it with A or B. Blending is what rule 1 forbids.

## The promotion rule

Movement is one-directional and event-driven: **a second consumer in another branch** promotes a
file one level up. Nothing else does.

```
_components/FindingCard/helpers.ts   (only FindingCard calls lineLabel)
        ↓  a list screen one directory up needs the same label
lib/findings.ts                      (now shared, now unit-tested)
```

Two corollaries:

- Reaching sideways into a sibling's private folder is worse than promoting. If you are typing
  `../../OtherFeature/_components/...`, the file being imported wanted promoting.
- Demote too. When the second consumer disappears, the file can go back. Shared folders that only
  grow are how `utils/` becomes a graveyard — the concrete cost named in
  [Kent C. Dodds, *Colocation*](https://kentcdodds.com/blog/colocation): the component gets
  deleted, the orphaned utility stays forever.

## Barrels

A barrel is an `index.ts` that re-exports other modules.

- **Per component: fine.** One file, one re-export line, no side effects. It lets the folder be
  renamed without touching callers.
- **Per folder: no.** A `components/index.ts` re-exporting everything makes every importer load the
  whole graph. Measured effect in a real Next.js app: pages loading 11k modules dropped to about
  3.5k — a 68% reduction — after internal barrels were removed
  ([tkdodo, *Please stop using barrel files*](https://tkdodo.eu/blog/please-stop-using-barrel-files)).
- **Circular imports** come from files inside the barrelled folder importing *through* the barrel
  instead of directly from their sibling. Import siblings by path.
- **In the App Router** a barrel that re-exports even one `'use client'` module drags that boundary
  onto everything imported from the barrel.
- Barrels are legitimate at the **public entry point of a package** — that is what
  `package.json#exports` points at. A vendored design system with one entry point is this case.

Whatever spelling you choose (`export { X } from "./X"` vs `export { default } from "./X"`), use
one. Several spellings of the same line means callers cannot predict whether the import is default
or named.

## `utils` vs `helpers` vs `lib`

The distinction that holds up in practice:

- **Utility** — generic, abstract, no knowledge of this product. `formatBytes`, `clamp`, `groupBy`.
  Would survive being copied into an unrelated project.
- **Helper** — specific to this product, usually to one component. `sizeOf(pr)`, `relativeTime`.
  Would be meaningless elsewhere.
- **lib** — the project's shared, tested middle layer: the API client, formatters everyone uses,
  domain calculations. In many codebases `lib/` and `utils/` are the same folder under two names;
  if so, pick one name and delete the other.

A helper that becomes shared does not become a utility — it becomes a shared helper. The word
changes only when the product knowledge is gone.

## Constants and registries

Two different things, often confused:

1. **Local literals** — a threshold, a sort weight, a column width, a keyboard map. Colocated
   `constants.ts`. No registry, no ceremony.
2. **Contracts between modules** — anything two modules must spell identically. Query keys, route
   paths, search-param names, status values, event names, storage keys. These get one exported
   registry, and everything imports from it.

The test: *if I typo this string, does something break silently at runtime rather than at compile
time?* If yes, it belongs in a registry.

```ts
// ✗ two files must remember the same literal
useQuery({ queryKey: ["orders", repoId], ... })
qc.invalidateQueries({ queryKey: ["orders", repoId] })

// ✓ one definition, both sites import it
export const queryKeys = { orders: (repoId: string) => ["orders", repoId] as const };
```

## Types

Promote types exactly like code (rule of two):

1. **Inline** — a component's props, a function's return shape. Inlining is cheap to refactor later
   and costs nothing now.
2. **Colocated `.types.ts`** — once two files in the folder share it.
3. **Shared** — once unrelated modules share it: the contract package, or the feature that owns the
   domain.

A global `types/` folder holding domain models is an anti-pattern: it separates the type from the
code that gives it meaning, and it never shrinks. Reserve `types/` for ambient declarations and
module augmentation.

Sources: [Total TypeScript — where to put your types](https://www.totaltypescript.com/where-to-put-your-types-in-application-code),
[Where your types live matters](https://blog.serghei.pl/posts/where-your-types-live-matters/).

## Styles, tests, copy, assets

- **Styles** — one mechanism per project. Component-level style definitions sit beside the
  component; colour/spacing/elevation tokens live in the design system so a theme change is one
  edit. A second mechanism "just for this screen" is how projects end up with three.
- **Tests** — colocated with the subject, because a test that lives far away is a test that does
  not get updated. The exception is end-to-end tests: they span systems and must survive a
  restructuring of `src/`, so they live in their own package (the explicit carve-out in
  [*Colocation*](https://kentcdodds.com/blog/colocation)).
- **Copy** — if the project has a translation layer, no user-facing string is written in JSX.
  Partial adoption is the failure mode: half the screens translated is the same as none, because no
  reviewer can tell whether a hardcoded string is a bug or a not-yet.
- **Assets** — beside the only component that uses them; the public folder once shared.

## Naming

Two independent decisions. Make each once, per tree:

- **Case** — kebab-case files everywhere, or PascalCase for components and kebab-case for the rest.
  Both work. Two conventions in two branches of the same repo does not, because the reader cannot
  predict a path they have not visited.
- **Descriptiveness** — folders named for the domain (`orders/`, `billing/`), not for the
  technology (`misc/`, `common/`, `stuff/`). Someone opening the tree should see what the product
  does, not which framework built it
  ([screaming architecture](https://medium.com/@hrynkevych/screaming-architecture-in-front-end-de72d9ec961c)).

## Import paths

Configure a path alias (`@/*` → `./src/*`) and use it for anything that is not a direct sibling.

- ✓ `import { api } from "@/lib/api"`
- ✓ `import { helpers } from "./helpers"` — siblings stay relative
- ✗ `import { api } from "../../../../../../lib/api"` — the depth tells you the file is in the
  wrong place, or the alias is not configured
- ✗ both styles for the same target inside one import block

Aliases are configured in `tsconfig.json#compilerOptions.paths` and must be mirrored in whatever
else resolves modules (the test runner, the bundler). Nothing enforces alias usage by default; see
[enforcement.md](enforcement.md).
