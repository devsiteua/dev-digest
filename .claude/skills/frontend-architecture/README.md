# frontend-architecture

**Version 1.0.0**

A skill about **where frontend code goes**: component placement and splitting, colocation versus
shared folders, constants, utilities, types, styles, tests, which layer owns business logic and
data access, and where the Server/Client Component boundary sits in the Next.js App Router.

Architecture and code organisation only. Performance is deliberately excluded.

## Files

| File | Purpose |
|---|---|
| `SKILL.md` | 13 placement rules, each with ✓/✗, plus the split-a-component signals |
| `references/file-layout.md` | What goes where; three canonical layouts and where each breaks; promotion rule; barrels; naming; import paths |
| `references/component-boundaries.md` | When to split, composition over configuration, slots, container/presentational |
| `references/logic-layers.md` | Pure functions → hooks → components; API client; key registries; state ownership |
| `references/nextjs-app-router.md` | Private folders, route groups, client boundary, the three data-handling models, DAL, server actions, loading/error boundaries |
| `references/enforcement.md` | Lint and build-time configuration that makes the rules non-optional |
| `references/devdigest-profile.md` | How each rule maps onto this repository, and the structural smells to check for |

## Relationship to the neighbouring skills

| Skill | Owns |
|---|---|
| **frontend-architecture** (this one) | where a file goes, which layer owns what, where boundaries sit |
| `react-best-practices` | what happens inside a component: derived state, `useEffect`, memoisation, keys, accessibility |
| `next-best-practices` | Next.js APIs, metadata, image and font handling, bundling |
| `react-testing-library` | how to write the test once you know where it lives |

There is intentionally no overlap. When a question is about placement, this skill answers it; when
it is about the code inside the file, the others do.

## Changelog

### 1.0.0 — initial

- 13 placement rules, six reference files, this bibliography.
- Positions taken on contested questions: one organising axis rather than a prescribed layout; the
  rule of two for promotion; per-component barrels only; a global `types/` folder rejected for
  domain models; state placed by ownership rather than by convenience.
- `references/devdigest-profile.md` records two places where this repository's own documents
  contradict each other, and states which one to follow.

Bump the minor version when a rule is added or a position changes; bump the patch version for
clarifications and new sources. Record the reason here — a skill whose rules change without a trace
cannot be trusted by the sessions that already followed the old ones.

## Evaluations

Three scenarios, each run in a fresh session with this skill loaded. They exist so the next version
is measured against the same bar.

1. **Placement.** *"Add a `PrLabels` component, rendered only on the PR detail page."*
   Expected: created under that route's `_components/PrLabels/`; `PrLabels.tsx` and `index.ts` are
   mandatory and the rest appear only if their content does; no `'use client'` (the parent subtree
   is already client); no promotion to `src/components/`.

2. **Layering.** *"We need a `GET /pulls/:id/notes` endpoint."*
   Expected: a new hook in `src/lib/hooks/`, re-exported through `hooks/index.ts`, with a query key
   that includes every parameter affecting the response; zero `fetch` in any component.

3. **Premature promotion.** *"Move this sorting function into shared utilities."*
   Expected: pushback via the rule of two — with one consumer it stays in the colocated
   `helpers.ts`; promotion happens when a second branch of the tree needs it.

**Regression check.** In the same session, ask a memoisation question. This skill should hand it to
`react-best-practices` rather than answering.

## Sources

Everything the rules are built on, with what each one contributed.

### Official documentation

- [Next.js — Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) —
  colocation, private `_folders`, route groups, the `src` folder, and the three supported
  organisation strategies (outside `app`, inside `app`, split by feature or route).
- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) —
  when to use each, `'use client'` as a module-graph boundary, passing server components as
  `children`, provider placement, `server-only` / `client-only`.
- [Next.js — How to Think About Security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions) —
  the three data-handling models, the Data Access Layer, DTOs, taint APIs, treating server-action
  arguments as hostile, and the audit checklist.
- [Next.js — Data Security](https://nextjs.org/docs/app/guides/data-security) — authorisation checks
  inside the data layer.
- [React — Thinking in React](https://react.dev/learn/thinking-in-react) — one component, one
  concern; component hierarchy following the data model.
- [React — Managing State](https://react.dev/learn/managing-state) — minimal state, derive the rest,
  do not lift further than necessary.
- [React — Sharing State Between Components](https://react.dev/learn/sharing-state-between-components) —
  lifting state to the closest common parent.
- [Anthropic — Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) —
  how this skill itself is structured: description written in third person with triggers, `SKILL.md`
  under 500 lines, references one level deep, a table of contents in files over 100 lines, no
  time-sensitive content.

### Reference architectures

- [bulletproof-react — Project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) —
  the `features/` layout and the unidirectional rule `shared → features → app`.
- [bulletproof-react — Project standards](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md) —
  the `import/no-restricted-paths` zone configuration, `check-file` naming rules, absolute imports.
- [Feature-Sliced Design — Overview](https://feature-sliced.design/docs/get-started/overview) —
  layers, slices and segments, and the rule that a layer may import only from layers strictly below.
- [FSD — The perfect folder structure for scalable frontend](https://feature-sliced.design/blog/frontend-folder-structure) —
  comparison of type-based, layered, atomic and FSD layouts, and the low-cohesion failure of
  type-based trees.
- [FSD — Atomic design](https://feature-sliced.design/blog/atomic-design-architecture) — atomic
  design as a design-system methodology, not an application architecture.
- [React Handbook — Project standards](https://reacthandbook.dev/project-standards) — start flat,
  reorganise on evidence, do not spend long planning a structure up front.

### Colocation and file layout

- [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation) — "place code as close to
  where it's relevant as possible"; the orphaned-utility cost; the explicit carve-out for
  end-to-end tests and system-wide documentation.
- [Robin Wieruch — React folder structure](https://www.robinwieruch.de/react-folder-structure/) —
  the progression from flat to feature to domain folders, and the promotion rule for utilities.
- [Josh Comeau — Delightful React file structure](https://www.joshwcomeau.com/react/file-structure/) —
  the by-function counter-position, kept in the skill as a deliberate contrast rather than
  suppressed.
- [tkdodo — Please stop using barrel files](https://tkdodo.eu/blog/please-stop-using-barrel-files) —
  circular imports through barrels, the 11k → 3.5k module reduction, and the one case where a
  barrel is justified.
- [Next.js — Barrel imports discussion](https://github.com/vercel/next.js/discussions/92926) —
  barrel behaviour in the App Router.
- [Screaming architecture in front-end](https://medium.com/@hrynkevych/screaming-architecture-in-front-end-de72d9ec961c) —
  folders named for the domain, not for the technology.

### Component boundaries and composition

- [Kent C. Dodds — When to break up a component](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) —
  structural signals for splitting, and the asymmetric cost of splitting late versus early.
- [Developer Way — Components composition](https://www.developerway.com/posts/components-composition-how-to-get-it-right) —
  composition over configuration, lifting content up, slots.
- [patterns.dev — Container/Presentational](https://www.patterns.dev/react/presentational-container-pattern/) —
  the pattern and its retraction by its author once hooks removed the need for the wrapper layer.

### Business logic and state

- [Felix Gerschau — Separation of concerns with React hooks](https://felixgerschau.com/react-hooks-separation-of-concerns/) —
  hooks as the application-logic layer between pure functions and components.
- [TanStack Query — Does this replace client state?](https://tanstack.com/query/v5/docs/framework/react/guides/does-this-replace-client-state) —
  server state versus client state, and why copying responses into a store is the common mistake.
- [Total TypeScript — Where to put your types](https://www.totaltypescript.com/where-to-put-your-types-in-application-code) —
  inline, then colocated, then shared; resist premature extraction.
- [Where your types live matters](https://blog.serghei.pl/posts/where-your-types-live-matters/) —
  domain types inside features; `types/` reserved for ambient declarations.

### Enforcement

- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) — declaring
  architectural elements and the dependency rules between them.
