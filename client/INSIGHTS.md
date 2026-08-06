# Insights — client

Append-only, newest first within each section. Sections, entry format, and promotion rules:
see the root [`../INSIGHTS.md`](../INSIGHTS.md).

---

## What Works

### 2026-08-06 · Seed an edit draft from the EVENT that opens the editor, never from an effect

Trigger:  adding in-card rewording to `ConventionCard` and the merge modal's body editor —
          both edit text derived from a TanStack query that refetches on every accept
Cause:    the 2026-08-06 "dep array wipes the draft" entry below fixes the effect; not
          having an effect at all removes the failure mode instead. The draft is seeded by
          the click that opens the editor (`setDraft({rule: candidate.rule, …})`) and by a
          LAZY `useState(() => conventionsToDraft(accepted, …))` at modal mount, so a new
          array identity from a refetch is simply never read again. The second half is
          freezing the derived ids with it — `useState(() => accepted.map(c => c.id))` —
          or the request would merge a different set of rows than the body was written from.
Takeaway: for "open an editor over server data", prefer event-seeded / lazily-initialised
          local state to `useEffect(setDraft, [data])`. Test it by rerendering the component
          with a DIFFERENT prop value after typing and asserting the field is unchanged; and
          have the failed-write path keep the draft open (`mutateAsync` + catch) rather than
          discarding what the user typed.
Evidence: src/app/repos/[repoId]/conventions/_components/CreateSkillModal/CreateSkillModal.tsx;
          src/app/repos/[repoId]/conventions/_components/ConventionCard/ConventionCard.tsx
Status:   resolved

### 2026-08-06 · One shared mutation hook can drive per-row pending state — read `mutation.variables`

Trigger:  the conventions screen renders N cards over ONE `useUpdateConvention()`, and
          `update.isPending` alone would have put "Accepting…" on every card at once
Cause:    TanStack Query v5 exposes the in-flight `variables` on the mutation result, so the
          list can ask *which* row is being written and towards what:
          `const pendingId = update.isPending ? update.variables?.id : undefined`, then
          `pending={pendingId === c.id ? update.variables?.patch.status : undefined}`. No
          `useState<Record<id, boolean>>` map, nothing to reset in an effect — and therefore
          none of the 2026-08-06 "query data in a dep array wipes the draft" failure mode.
          The limit is real and worth knowing: `variables` holds the LATEST call, so a bulk
          action that fires several `mutate()`s marks only the last one as pending.
Takeaway: for a list whose rows share one mutation, derive the row's busy state from
          `mutation.variables` rather than lifting a per-row flag. Reach for a local map only
          when concurrent writes must each show their own spinner.
Evidence: src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.tsx
Status:   resolved

### 2026-08-06 · A screen-level component test has to stub `components/app-shell`

Trigger:  first tests for `SkillsListView` / `SkillsRail` — components that render a whole
          route, not a leaf. Every earlier component test stopped below the shell.
Cause:    `<AppShell>` reads far more than its `{children, crumb}` props suggest:
          `useShellContext` pulls `useActiveRepo`, `useTheme` and `usePulls(repoId)`
          (`components/app-shell/hooks/useShellContext.ts:22-29`), so rendering it drags in
          the repo provider, the theme provider, a QueryClient and the `shell` message
          namespace — none of which the screen under test is about.
Takeaway: `vi.mock("…/components/app-shell", () => ({ AppShell: ({children}) => <div>{children}</div> }))`
          and keep the test on the screen's own content. Same rule of thumb as the hook
          mocks below: stub at the seam, do not assemble the app. Pair it with mocking the
          route's hook module — and add the drawer/modal hooks a screen imports but does not
          render, or the module mock leaves those bindings undefined.
Evidence: src/app/skills/_components/SkillsListView/SkillsListView.test.tsx
Status:   resolved

## What Doesn't Work

### 2026-08-06 · The design's empty artboard REPLACES the screen — porting the header over it duplicates the CTA

Trigger:  the conventions screen shipped with two identical "Run extraction" buttons on an
          empty repo, caught by a test that could not resolve `getByRole("button")`
Cause:    the prototype's empty variant is an early return, not a branch inside the body:
          `if (empty) return AppFrame(EmptyState)` — no `<h1>`, no toolbar, no scan button
          (`conventions-and-conformance.jsx:70`). Building the populated screen first and then
          adding `EmptyState` under the header — the obvious order — gives the header's
          primary action and the EmptyState's `cta` the same job and the same words. Every
          empty artboard in the design is built this way (`e-ci`, `e-tour`, `e-context`,
          `e-conv` in `reference-app.jsx:168-184` all pass `empty` to the same component).
Takeaway: read the design's `empty` branch before laying out the header, and decide which of
          the two surfaces owns the action. Keeping the heading for orientation is a fine
          deviation; keeping the header's BUTTON is not. A component test that queries a
          button by name is what catches this — `getByRole` throws on a duplicate, so write
          the empty-state test with `getByRole`, not `getAllByRole`.
Evidence: src/app/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.tsx
Status:   resolved

### 2026-08-06 · A query result in an effect's dep array wipes the local draft it was meant to seed

Trigger:  the agent editor's Skills tab: every checkbox click appeared to do nothing, and
          three tests failed with the draft reverting to the saved order
Cause:    `React.useEffect(() => setDraft(null), [agent.id, links])` — `links` is the array
          from `useAgentSkills`. TanStack Query hands back a NEW array identity on every
          refetch, and this tab's own save calls `setQueryData` + `invalidateQueries`, so the
          effect fired and discarded the user's in-progress edit. Under the test's mocked
          hook the identity changed on literally every render, which turned an intermittent
          production bug into a deterministic failure.
Takeaway: an effect that resets local edit state must depend on the ENTITY IDENTITY being
          edited (`agent.id`), never on the fetched collection. Clear the draft explicitly in
          the mutation's `onSuccess` instead. Rule of thumb: if a dep is a query's `data`,
          ask what a background refetch would do to the user mid-typing.
Evidence: src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx
Status:   resolved

## Codebase Patterns

### 2026-08-06 · The design's `CodeEditor` has no port, and `BRIDGE.md` does not say so

Trigger:  the N7 artboard `conv-create` renders the merged skill body in `window.CodeEditor`;
          grep found no such export in `@devdigest/ui`, and BRIDGE.md's mapping table does
          not list it in either direction — neither ported nor named as missing
Cause:    the port covers `foundation/primitives.jsx` + `ui-kit.jsx`; `CodeEditor` lives
          outside both, so it fell out of the table silently. Every design screen that shows
          editable code or markdown (skill body, agent prompt, eval input) hits this.
Takeaway: substitute, do not port: `<Textarea mono rows={…}>` inside a `FormField` whose
          `right=` slot carries `~{tokens} tokens · {chars}/{max} chars` from
          `approxTokens()` (`@/lib/tokens`). That is what `SkillEditor/…/ConfigTab` already
          does, and the two screens edit the same field — a CodeEditor on one of them would
          make the same text look like two different things. Adding the primitive means
          touching `vendor/ui`, which needs an explicit request.
Evidence: src/app/repos/[repoId]/conventions/_components/CreateSkillModal/CreateSkillModal.tsx;
          src/app/skills/[id]/_components/SkillEditor/_components/ConfigTab/ConfigTab.tsx
Status:   resolved

### 2026-08-05 · `CLAUDE.md` and `docs/component-anatomy.md` disagree on how many files a component folder needs

Trigger:  writing the `frontend-architecture` skill's acceptance criteria for "add a new
          component", and needing a decidable answer to "which files are mandatory?"
Cause:    the two documents state opposite rules. `CLAUDE.md:25-27` lists all six files
          (`<Name>.tsx · styles.ts · constants.ts · helpers.ts · index.ts · <Name>.test.tsx`)
          and says *"follow it rather than inventing a shorter one"*; `docs/component-anatomy.md:20`
          says *"Only `<Name>.tsx` and `index.ts` are mandatory; add the others as soon as the
          corresponding content appears"*. The tree follows the second: a dozen component folders
          ship without `styles.ts`, and `RunHistory/` has no `index.ts`. So the "12 folders violate
          the convention" reading of the tree is wrong — they satisfy the narrower rule, and the
          count is an artefact of comparing against the wider one.
Takeaway: follow `docs/component-anatomy.md` — it is the more specific document and the one
          `CLAUDE.md`'s own "Read when" section points to for this task. Read `CLAUDE.md`'s sentence
          as "do not invent a *different* shape", not "create six files regardless of content". The
          real violation to look for is a component with styles that keeps them inline anyway.
Evidence: client/CLAUDE.md:25-27; client/docs/component-anatomy.md:20;
          .claude/skills/frontend-architecture/references/devdigest-profile.md
Status:   open — one of the two sentences should be reworded; not done here to avoid changing a
          convention as a side effect of writing a skill

### 2026-08-06 · `@devdigest/ui`'s `<Markdown>` tags its output `.dd-md` but ships no CSS for it

Trigger:  the skill Preview tab rendered headings and lists at browser defaults — Times-ish
          `h1`, no spacing — nothing like the rest of the app
Cause:    `primitives/Markdown.tsx` only overrides `p`, `strong`, `code` and `a` inline; every
          other element relies on the `.dd-md` wrapper class, and `grep dd-md` across
          `vendor/ui/styles.css` and the app's CSS returns nothing. The class is a hook that
          was never given rules.
Takeaway: any screen rendering `<Markdown>` with real documents (headings, lists, fences,
          tables) must bring its own `.dd-md` rules. Put them in that component's `styles.ts`
          and inject with a scoped `<style>` — `vendor/ui` is off-limits, and a global rule
          would be an invisible dependency for the next screen that uses the component.
Evidence: src/app/skills/[id]/_components/SkillEditor/styles.ts (MARKDOWN_CSS)
Status:   resolved

### 2026-08-02 · A card with `overflow: hidden` silently clips anything its rows pop up

Trigger:  the PR list's new findings popover rendered in the DOM, passed its test, and was
          invisible in the browser
Cause:    `pulls/styles.ts` `tableCard` carried `overflow: hidden` to clip the rows to its
          rounded corners. That clips every absolutely-positioned descendant too — popover,
          dropdown, tooltip — no matter how high its `z-index`. The design's own dashboard sets
          `overflow: visible` on the same container for exactly this reason.
Takeaway: before adding a hover popover, dropdown or tooltip to a table row, check the
          container's `overflow` first — the symptom is "renders, but nothing appears", which
          reads like a state bug and is not one. The trade is that the last row's corners no
          longer clip; the design accepts it.
Evidence: client/src/app/repos/[repoId]/pulls/styles.ts (tableCard);
          DevDigest-Design-unpacked/src/14-screen_dashboard.jsx:111
Status:   resolved

## Tool & Library Notes

### 2026-08-06 · `Textarea` swallows extra props, `TextInput` forwards them — only one can take an `aria-label`

Trigger:  labelling the in-card rule editor so its test could use `getByLabelText("Rule")`;
          `aria-label` on `<Textarea>` did nothing and TypeScript rejected `id`
Cause:    `vendor/ui/kit/TextInput.tsx` ends its props with
          `& Omit<React.InputHTMLAttributes<HTMLInputElement>, …>` and spreads `...rest` onto
          the input; `vendor/ui/kit/Textarea.tsx` declares five props and spreads nothing.
          Two sibling primitives, opposite prop contracts, and `vendor/ui` is do-not-touch.
Takeaway: nest the control inside its `<label>` — implicit association names both kinds of
          field and is what `getByLabelText` resolves. `FormField`'s label is NOT associated
          with its child (no `htmlFor`, child is a sibling), so a screen built from
          `FormField` has to be queried by `getByDisplayValue` or
          `document.querySelector("textarea")`, the way the skill-editor tests do.
Evidence: src/app/repos/[repoId]/conventions/_components/ConventionCard/ConventionCard.tsx;
          src/vendor/ui/kit/Textarea.tsx vs src/vendor/ui/kit/TextInput.tsx
Status:   resolved

### 2026-08-02 · jsdom drops any CSS declaration containing `var()`, so `toHaveStyle` is blind to every design token

Trigger:  asserting that the severity counters render as dotted-underlined text in the
          severity colour; the component was correct and the test failed with an empty diff
Cause:    React writes `style="border-bottom: 1px dotted var(--crit)"` onto the element — the
          attribute is verifiably there — but jsdom's computed-style parser refuses to accept a
          declaration containing `var()`, so `toHaveStyle` sees nothing. Longhands
          (`borderBottomColor`) behave identically. Since nothing in this codebase styles with
          literal colours, this defeats every token-based visual assertion, not just border ones.
Takeaway: assert on `element.getAttribute("style")` with `toContain("... var(--crit)")`. Do not
          reach for `getComputedStyle` or try to inject the token — the parser, not the
          cascade, is what drops it.
Evidence: client/src/app/repos/[repoId]/pulls/_components/SeverityCounters/SeverityCounters.test.tsx
Status:   resolved

### 2026-08-02 · `borderColor` is itself a shorthand — pairing it with `borderLeftColor` makes React warn

Trigger:  adding a filter to `FindingsPanel`, which made its cards rerender for the first
          time; every click printed "Updating a style property during rerender (borderColor)
          when a conflicting property is set (borderLeftColor)"
Cause:    `FindingCard/styles.ts` already carried a comment saying it used all-longhand to
          avoid exactly this, but `borderColor` sets all four sides, so it still conflicts
          with the `borderLeftColor` that draws the severity stripe. The warning had simply
          never fired, because nothing in the panel used to rerender. Fixed by spelling out
          `borderTopColor` / `borderRightColor` / `borderBottomColor`.
Takeaway: "longhand" in React's warning means *per-side*, not merely "not `border`".
          `borderColor`, `borderWidth`, `margin`, `padding` are all shorthands. If a style
          object sets one side explicitly, set the other three explicitly too — and note that
          a static component can hide this class of bug indefinitely.
Evidence: client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/styles.ts
Status:   resolved

## Recurring Errors & Fixes

_None yet._

## Session Notes

_None yet._

## Open Questions

_None yet._
