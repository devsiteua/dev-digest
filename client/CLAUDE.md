# @devdigest/web — Next.js 15 App Router. UI only, no business logic.

## Commands

```sh
pnpm dev         # :3000
pnpm test        # vitest + jsdom, fetch mocked — no API, no browser
pnpm typecheck
```

## Map

| Path | What |
|------|------|
| `src/app/**/page.tsx` | thin pages |
| `src/app/**/_components/<N>/` | all feature logic, colocated with the route |
| `src/lib/hooks/*` | the **only** way to fetch data (TanStack Query) |
| `src/lib/api.ts` | `apiFetch` + `ApiError` |
| `src/vendor/ui/` | `@devdigest/ui` — vendored design system |
| `src/vendor/shared/` | mirror of the server's Zod contracts |
| `messages/<locale>/` | next-intl strings — no hardcoded copy in components |

## Conventions

- A component is a folder `_components/<Name>/` containing
  `<Name>.tsx · styles.ts · constants.ts · helpers.ts · index.ts · <Name>.test.tsx`.
  Verbose, but identical across every screen — follow it rather than inventing a shorter one.
- No `fetch` inside components. A new endpoint means a new hook in `src/lib/hooks/`, exported
  through `hooks/index.ts`.
- In-flight run state comes from the server (`GET /pulls/:id/runs/active`), not local state —
  it must survive a page reload.
- After a mutation, invalidate the query keys it affects; saving a provider key must also
  invalidate `provider-models` and `secrets-status`.
- Pages are client components where they need hooks; keep server/client boundaries at the
  page level rather than sprinkling `"use client"` through leaf components.

## Gotchas

- `src/vendor/shared` is a **copy** of the server's contracts. Apply contract edits in both
  places and diff before committing.
- Tests start neither the API nor a browser. Do not write integration expectations here —
  real journeys belong to `../e2e`.
- `/` redirects to the first repo's PR list, or to `/onboarding` when there are none. Flows
  and tests that assume a landing page will be wrong.
- `ApiError.status === 0` means the API is unreachable, not an HTTP error — the error UX
  branches on it for the full-screen state.

## Do not touch

- `src/vendor/ui/**` — vendored design system; edit only on explicit request
- `.next/**`

## Read when

- Adding a screen or a data hook → read `README.md` (UI route map) and
  `docs/component-anatomy.md`
- Unsure where a file belongs, or reshaping folders → run `/frontend-architecture`; its
  `references/devdigest-profile.md` maps the general rules onto this package
- Writing a component test → read `../TESTING.md`
- The UI or query cache behaves unexpectedly → read `INSIGHTS.md` first
- Starting a task → read `specs/README.md`
