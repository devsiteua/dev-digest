# Next.js App Router — structure and boundaries

## Contents

- Colocation and private folders
- Route groups
- Where the client boundary goes
- Interleaving: server components inside client components
- Providers
- Choosing a data-handling model
- The Data Access Layer
- Server actions
- Loading, error and not-found boundaries

## Colocation and private folders

A folder in `app/` becomes a route only when it contains `page.tsx` or `route.ts`. Everything else
in that folder is invisible to routing, so project files can be colocated inside route segments
without becoming URLs. Only what `page`/`route` returns is sent to the client.

A folder prefixed with an underscore (`_components`, `_lib`) is opted out of routing entirely,
including its subfolders. Since colocation is already safe by default, the underscore buys three
things: it separates UI from routing at a glance, it groups internals consistently, and it removes
any chance of colliding with a future framework file convention.

```
app/orders/
  page.tsx              → /orders
  _components/          not routable
  _lib/queries.ts       not routable
```

Source: [Next.js — project structure](https://nextjs.org/docs/app/getting-started/project-structure).

## Route groups

`(name)` groups routes without contributing a URL segment. Use them to:

- organise routes by section, intent or team
- give a subset of routes a shared layout
- scope a `loading.tsx` to some routes and not their siblings
- run multiple root layouts (each then needs its own `<html>` and `<body>`)

Route groups are the tool for "these screens share a shell but not a URL prefix". Reaching for a
folder that *does* appear in the URL, purely for organisation, is how URLs end up describing the
codebase instead of the product.

## Where the client boundary goes

`'use client'` is a **module-graph boundary**, not a per-component annotation. Once a file carries
it, everything that file imports — and every component it directly renders — is in the client
bundle. You do not repeat the directive down the tree.

Decision rule:

| Need | Component type |
|---|---|
| state, event handlers, effects, browser APIs, custom hooks | client |
| reading data at the source, secrets, less JS shipped, streaming | server |

- ✓ one directive at the root of the interactive subtree
- ✗ the directive on leaves that are already inside a client subtree — harmless at runtime, but it
  hides where the real boundary is, and after a while nobody can tell which node is load-bearing
- ✗ **a shared UI package that uses hooks and carries no directive at all.** It compiles only
  because no server component imports it yet. The first server component that renders a `Button`
  breaks the build. Library entry points that rely on client-only features should carry the
  directive themselves; for third-party components that do not, wrap them in a one-line local
  client module and import that.

Source: [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components).

## Interleaving: server components inside client components

A client component cannot **import** a server component. It can **receive** one — as `children` or
any other prop — because props are not part of the importing module's graph. The server component
renders on the server; the client component gets its output.

```tsx
// modal.tsx — client: owns the open/closed state
'use client'
export default function Modal({ children }: { children: React.ReactNode }) { … }

// page.tsx — server: Cart still runs on the server
export default function Page() {
  return <Modal><Cart /></Modal>;
}
```

This is the escape hatch that keeps interactive shells from dragging their contents to the client.
It is also the structural reason to prefer slots over data props (see
[component-boundaries.md](component-boundaries.md)).

## Providers

Context requires a client component. Create a thin `'use client'` provider that takes `children`,
then render it from a server layout.

Render providers **as deep as possible**: a provider wrapping `{children}` rather than the whole
document leaves more of the tree statically optimisable. A root layout that wraps everything in
every provider is the default that nobody revisits.

## Choosing a data-handling model

The framework authors name three, and recommend picking **one** per project — mixing them makes it
impossible for a reader or an auditor to know what to expect, and exceptions stop looking
suspicious ([How to think about security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions)).

| Model | Use when | Shape |
|---|---|---|
| **HTTP APIs** | adding server components to an existing system with a real backend | server components call your API over HTTP like any client would, passing cookies; zero-trust, no assumption of a safe internal network |
| **Data Access Layer** | new projects | a server-only module owns all data access and authorisation; components call it in-process |
| **Component-level access** | prototypes and learning | queries inline in server components |

Component-level access is explicitly *not* recommended beyond prototyping: it puts authorisation
decisions wherever someone happened to write a query.

## The Data Access Layer

An internal module that is the only thing allowed to touch the database or secrets.

Its rules:

- Every function takes (or reads) the current user and **checks authorisation before returning
  data**. A server component body should only ever see data the requesting user may see.
- It returns **DTOs** — the minimal shape the UI needs — not full database rows. `SELECT *` handed
  to a client component ships every column to the browser, including the ones nobody looked at.
- Only the DAL reads `process.env` for secrets.
- Mark it `import 'server-only'` so importing it from a client component fails at build time.
- Read authorisation and identity **at the point of use**, not by passing the user down through
  props — a cached accessor gives the same value everywhere without threading it through
  components, and threading is how it eventually reaches a client boundary.

```ts
import 'server-only';

export async function getOrderDTO(id: string) {
  const user = await getCurrentUser();
  const row = await db.order(id);
  if (!canSee(user, row)) return null;
  return { id: row.id, total: row.total, status: row.status }; // not the whole row
}
```

Related: [Data security](https://nextjs.org/docs/app/guides/data-security).

## Server actions

`'use server'` exports a callable endpoint. Anyone who obtains its id can invoke it with **any**
arguments, so:

- validate every argument — TypeScript annotations are not enforced at runtime
- re-authorise inside the action; do not trust that the caller reached a protected page
- keep the action thin: validate, authorise, delegate to the DAL, revalidate. Business logic that
  lives inside actions cannot be reused or tested without invoking the endpoint

Placement: beside the feature that uses them, marked `'use server'`, importing the DAL. A global
`actions/` folder collecting unrelated mutations recreates the problem feature folders exist to
avoid.

Also structural: URL inputs (`searchParams`, dynamic params) are user input. `/[team]/` in the path
is not evidence the user may see that team — re-verify when reading, every time.

## Loading, error and not-found boundaries

`loading.tsx`, `error.tsx` and `not-found.tsx` are placement decisions: each attaches to the segment
whose UI it covers, and nests with the segment tree.

- Put a boundary on the **slow** segment so the rest of the page stays interactive, rather than one
  boundary at the root that blanks the whole screen.
- Use a route group to scope a loading state to some sibling routes and not others.
- `error.tsx` is a React error boundary and therefore a client component; it does not catch errors
  in event handlers or in async code outside rendering — those still need explicit handling.
- No boundaries anywhere is itself a decision, and usually an accidental one: it means every slow
  segment blocks its whole page and every thrown error reaches the root.
