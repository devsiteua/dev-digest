# Logic layers — where business logic and data access live

## Contents

- The three layers
- One feature, split across them
- The API client
- Key registries and invalidation
- State ownership
- Why context is not a store

## The three layers

| Layer | Contains | Depends on | Tested by |
|---|---|---|---|
| **Domain** — pure functions | business rules, calculations, derivations, validation, formatting | nothing | calling them |
| **Application** — hooks | fetching, caching, subscriptions, invalidation, orchestration, wiring domain functions to state | domain | rendering a hook, or mocking the module |
| **Presentation** — components | markup, local UI state, event handlers | application | rendering |

The direction is strict. A pure function never imports a hook; a hook never imports a component.

The value is concentrated in the first layer: business rules expressed as pure functions can be
tested by calling them with arguments — no renderer, no mock server, no act warnings. Everything
that stays inside a component body can only be tested through the UI, which is slower, flakier, and
tests the wrong thing.

Sources: [Separation of concerns with React hooks](https://felixgerschau.com/react-hooks-separation-of-concerns/);
[Thinking in React](https://react.dev/learn/thinking-in-react).

## One feature, split across them

"Show orders, filter by status, sort by value, let the user retry a failed one."

```ts
// domain — no React, no network. This is where the product rules live.
export function filterByStatus(orders: Order[], status: Status | "all"): Order[] { … }
export function sortByValue(orders: Order[], dir: "asc" | "desc"): Order[] { … }
export function isRetryable(order: Order): boolean {
  return order.status === "failed" && order.attempts < MAX_ATTEMPTS;
}
```

```ts
// application — owns the server round-trip and the cache, uses the domain functions
export function useOrders(repoId: string) {
  return useQuery({
    queryKey: queryKeys.orders(repoId),
    queryFn: () => api.get<Order[]>(`/repos/${repoId}/orders`),
  });
}

export function useRetryOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Order>(`/orders/${id}/retry`, {}),
    onSuccess: (_, id) => qc.invalidateQueries({ queryKey: queryKeys.orders(id) }),
  });
}
```

```tsx
// presentation — reads params, calls hooks, composes. No fetch, no business rules.
export function OrdersScreen({ repoId }: { repoId: string }) {
  const { data, isPending, error } = useOrders(repoId);
  const [status, setStatus] = useSearchParamState("status", "all");

  if (isPending) return <Skeleton />;
  if (error) return <ErrorState error={error} />;

  const rows = sortByValue(filterByStatus(data, status), "desc");
  return <OrderTable rows={rows} onStatusChange={setStatus} />;
}
```

What each layer bought:

- `isRetryable` is one line to test and impossible to get subtly wrong in three different screens.
- The screen has no idea whether orders come from REST, a database, or a cache.
- Replacing the transport touches one file.

## The API client

One module owns transport concerns, and nothing above it knows how they work:

- the base URL
- headers and authentication
- turning every failure into **one** error type, so callers branch on a known shape rather than on
  whatever the network threw
- cancellation

Callers use verbs (`api.get`, `api.post`), never the raw transport. This is the seam where you
would swap fetch for something else, add retries, or add tracing — and none of that should be
visible upstream.

Two rules that repay themselves:

- **Distinguish "the server said no" from "there was no server."** A transport failure is not an
  HTTP status; giving it a sentinel (for example `status === 0`) lets the UI show a full-screen
  "cannot reach the API" state instead of a misleading per-widget error.
- **Decide whether responses are validated or trusted.** Casting an unvalidated response to a type
  is a choice, not a default — make it deliberately and write it down, because the types will look
  identical either way and the failure appears far from the cause.

## Key registries and invalidation

Cache keys are a contract between the code that reads and the code that invalidates. Written as
literals in both places, they drift silently: the mutation succeeds, the list does not refresh, and
nothing errors.

```ts
export const queryKeys = {
  orders:      (repoId: string) => ["orders", repoId] as const,
  order:       (id: string)     => ["order", id] as const,
  activeRuns:  (prId: string)   => ["pr-active-runs", prId] as const,
};
```

- Every key starts with a stable domain string and includes **every parameter that changes the
  response** — a key missing a parameter serves one tenant's data to another.
- **Every mutation declares what it invalidates**, beside the mutation itself.
- Coupled invalidations (saving X must also refresh Y and Z) belong in the mutation, not in prose
  in a README. A rule that only exists in documentation gets followed until the first person who
  did not read it.

## State ownership

Ask who owns the value; the owner determines the home.

| Owner | Home | Why |
|---|---|---|
| The server | query/cache library | it can change without you; it needs revalidation, not a copy |
| The URL | search params | survives reload, back/forward, and being pasted into chat |
| One subtree | local state | nothing else needs to know |
| Cross-cutting dependency | context | it is injection, not storage |

Specifics:

- **Server state does not go into a client store.** Copying a response into a global store means
  hand-writing loading flags, staleness, and refetch logic that the cache library already does —
  and then keeping two copies in sync
  ([TanStack Query — does this replace client state?](https://tanstack.com/query/v5/docs/framework/react/guides/does-this-replace-client-state)).
- **Anything a user would expect to survive a reload, or to be shareable, belongs in the URL** —
  the open tab, active filters, sort, pagination, an open drawer. This is a placement decision with
  visible product consequences: state in `useState` is state that disappears on refresh and cannot
  be linked to.
- **Lift state only as far as the closest common parent**, and no further. State parked higher than
  necessary re-renders subtrees that do not care and makes the owning component harder to reason
  about ([Managing state](https://react.dev/learn/managing-state),
  [Sharing state between components](https://react.dev/learn/sharing-state-between-components)).
- **In-flight work belongs to whoever survives a reload.** If a long-running job's progress lives
  only in component state, refreshing the page loses it. If the server can report it, the server
  owns it.

## Why context is not a store

Context solves *distribution* — getting a value to a deep consumer without threading it through
every level. It does not solve *state management*: it has no selectors, so every consumer
re-renders when the value changes, and no amount of splitting fixes that in general.

- ✓ theme, current user, a toast dispatcher, a configured client instance
- ✗ a list of entities that half the app mutates
- ✗ a value that only one subtree needs — pass it, or let that subtree own it

If several unrelated things live in one context, split it by concern. If consumers need to select
part of a large value without re-rendering, you need a store, not a context.
