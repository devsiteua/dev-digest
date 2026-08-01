# Component anatomy — how to add things to the web app

Recipes for the three things you will actually add: a component, a data hook, a screen. The
route map and stack overview are in `../README.md`.

## A component

Every feature component is a folder colocated with the route that uses it:

```
_components/<Name>/
  <Name>.tsx        the component — markup, local state, event handlers
  styles.ts         `export const s = { key: {...} satisfies CSSProperties }`
  constants.ts      literals: thresholds, sort weights, keyboard maps
  helpers.ts        pure functions over props/data — the part worth unit-testing
  index.ts          `export { Name, Name as default } from "./Name";`
  <Name>.test.tsx   RTL test (only where behaviour is worth pinning)
```

Only `<Name>.tsx` and `index.ts` are mandatory; add the others as soon as the corresponding
content appears, rather than letting inline styles or magic numbers accumulate.

Nested sub-components go one level deeper in `<Name>/_components/<Child>/` with the same
shape — see `RunTraceDrawer/`.

Styling is inline objects from `styles.ts` plus CSS custom properties from the design system
(`var(--border)`, `var(--text-secondary)`, …). Do not introduce a second styling mechanism.

Reusable primitives come from `@devdigest/ui` (`Button`, `Card`, `Badge`, `EmptyState`,
`Skeleton`, `Modal`, `Drawer`, `Tabs`, charts…). Check there before writing a new one — and
remember `src/vendor/ui/**` itself is vendored and off-limits for casual edits.

Copy goes through next-intl: add the string to `messages/en/<namespace>.json` and read it with
`useTranslations`. No hardcoded user-facing text.

## A data hook

One hook per endpoint, in the domain file under `src/lib/hooks/`
(`core` · `agents` · `reviews` · `trace` · `repo-intel`), re-exported by `hooks/index.ts`.

```ts
export function useThings(repoId: string) {
  return useQuery({
    queryKey: ["things", repoId],
    queryFn: () => api.get<Thing[]>(`/repos/${repoId}/things`),
  });
}

export function useDoThing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Thing>(`/things/${id}/do`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["things"] }),
  });
}
```

Rules:

- Types come from `@devdigest/shared` (via `src/lib/types.ts`), not hand-written interfaces.
- Query keys are arrays starting with a stable domain string; include every parameter that
  changes the response.
- Every mutation declares what it invalidates. A mutation that changes provider keys must also
  invalidate `provider-models` and `secrets-status`.
- Use `staleTime` for data that is expensive and slow-moving (secrets status, model lists).
- Errors surface as `ApiError`; `status === 0` means the API is unreachable and drives the
  full-screen error state rather than a toast.

## A screen

1. `src/app/<route>/page.tsx` — thin: read params, call hooks, compose components, handle the
   loading / empty / error triad (`Skeleton`, `EmptyState`, `ErrorState`).
2. Wrap in `AppShell` with a breadcrumb, and `PageContainer` with a title.
3. Put every non-trivial piece into `_components/`.

Long-running work streams over SSE from `/runs/:id/events`; subscribe with the existing run
hooks rather than opening an `EventSource` by hand, and always reconcile against the server's
`GET /pulls/:id/runs/active` so a reload restores the real state.

## Tests

Vitest + jsdom, `fetch` mocked, no API and no browser. A test typically:

```ts
vi.mock("../../../lib/hooks/reviews", () => ({ useFindingAction: () => ({ mutate: vi.fn(), isPending: false }) }));
render(<NextIntlClientProvider messages={messages} locale="en"><FindingsPanel … /></NextIntlClientProvider>);
```

- Mock the hook module, not `fetch`, when the component only consumes hooks.
- Wrap in `NextIntlClientProvider` with the real `messages/en/*.json` so missing keys fail loudly.
- Test what the user sees and does — rendered text, clicks, keyboard shortcuts. Pure logic
  belongs in `helpers.ts` and is tested directly.
- `afterEach(cleanup)`.

Full browser journeys are the `e2e/` package's job, not this suite's.
