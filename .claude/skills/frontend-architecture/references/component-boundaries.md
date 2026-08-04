# Component boundaries — when to split, and along which seam

## Contents

- Signals that a component wants splitting
- Signals that it does not
- Splitting along the right seam
- Composition over configuration
- Slots
- Container / presentational, and what replaced it
- The props budget

## Signals that a component wants splitting

Structural signals. Line count is a symptom, never the diagnosis — a 300-line form with one
responsibility is fine, a 60-line component doing two things is not.

- **Branching that changes what the component *is*.** `if (mode === "edit")` returning a different
  tree is two components sharing a file.
- **Two sets of state that never change together.** Nothing connects them; they were only colocated
  by accident of typing.
- **A name that needs "and".** `OrderTableAndFilters` is a folder, not a component.
- **Repeated conditional rendering of the same block** with different data — that block is a
  component and the data is its props.
- **A section you cannot describe without describing the whole component.** If you cannot name it,
  you cannot extract it yet; keep reading the code until you can.
- **The test needs elaborate setup to reach one behaviour.** Test friction maps almost exactly onto
  boundary problems: the thing you are struggling to reach wants to be reachable directly.

The failure mode is asymmetric. Extracting too late produces a monolith that is expensive to
untangle; extracting too early produces an indirection that is cheap to inline. When genuinely
unsure, wait — but know that most codebases err on waiting too long
([Kent C. Dodds, *When to break up a component*](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components)).

## Signals that it does not

- **"It's long."** Length alone is not a seam.
- **"It might be reused."** Might is not a consumer. See the rule of two.
- **A wrapper that only forwards props.** It adds a file, a name, and an indirection, and gives
  nothing back.
- **A component whose whole body is one hook call plus `return null`.** Call the hook.

## Splitting along the right seam

Two components extracted from the same monolith can be right or wrong depending on where the cut
lands. Cut along **what changes together**, not along visual regions.

```
✗ cut by position on screen        ✓ cut by responsibility
  <TopHalf />                        <OrderSummary />      owns: one order's derived totals
  <BottomHalf />                     <OrderLineItems />    owns: the editable line list
```

The test for a good cut: each side can be described in one sentence that does not mention the
other, and each side's props are its own data — not a slice of the parent's state passed down so
the child can push it back up.

## Composition over configuration

When a component grows props that only exist to switch behaviour on and off, it wants composition
instead.

```tsx
// ✗ configuration — every new case adds a prop and a branch inside
<Card title="Orders" showFooter withIcon iconName="box" collapsible headerAlign="right" />

// ✓ composition — the caller assembles what it needs
<Card>
  <Card.Header align="right"><Icon name="box" /> Orders</Card.Header>
  <Card.Body>…</Card.Body>
</Card>
```

The configuration version has to anticipate every combination; the composition version does not
have to anticipate anything. The cost is a slightly more verbose call site, which is where the
knowledge belongs anyway.

Source: [Developer Way — components composition](https://www.developerway.com/posts/components-composition-how-to-get-it-right).

## Slots

`children` is the primary slot; additional slots are just props that take elements.

```tsx
<Modal
  header={<OrderTitle id={id} />}
  footer={<ConfirmButtons onConfirm={…} />}
>
  <OrderDetails id={id} />
</Modal>
```

Two things this buys:

1. **The wrapper stops needing the data.** `Modal` does not import `OrderTitle`, does not know what
   an order is, and does not re-render when order data changes.
2. **In the App Router it is the only way to keep server content inside a client shell.** A client
   component cannot *import* a server component, but it can receive one as `children` — the server
   component renders on the server and arrives as already-rendered output. See
   [nextjs-app-router.md](nextjs-app-router.md).

This is also the fix for prop drilling that does not require context: pass the rendered element
down instead of the data needed to render it.

## Container / presentational, and what replaced it

The 2015 pattern — a stateful container wrapping a pure presentational component — was retracted by
its own author in 2019: hooks made the wrapper layer unnecessary, and the split had become an
arbitrary division rather than a real boundary
([patterns.dev](https://www.patterns.dev/react/presentational-container-pattern/)).

What survives is the *principle*, not the folder convention:

- Business rules live in pure functions, application logic in hooks, rendering in components
  (SKILL.md rule 7). That is the same separation without the extra component.
- **The split came back as a real boundary in a different form.** A server component that fetches
  and a client component that interacts is exactly container/presentational — but now it is
  enforced by the runtime rather than by convention, and the line falls where the *environment*
  changes rather than where a developer decided.

So: do not create `containers/` and `components/` folders. Do notice that your interactive leaf and
your data-fetching parent are different kinds of thing, and let the boundary rules place them.

## The props budget

More than about seven props is a signal, not a limit. Ask which of these it is:

- **Several props are one thing.** `userName`, `userAvatar`, `userRole` → pass `user`.
- **Several props are switches.** → composition (above).
- **Several props are unrelated.** → the component is unrelated things.
- **Props are being forwarded straight through.** → the intermediate component may not need to
  exist, or should take `children`.

One caveat that matters for the client boundary: props crossing from a server component to a client
component must be serialisable, and should carry the **minimum** the child needs. Passing a whole
domain object because it is convenient sends every field of it to the browser — a correctness and
privacy issue, not a style one. Details in [nextjs-app-router.md](nextjs-app-router.md).
