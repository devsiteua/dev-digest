# Insights — client

Append-only, newest first within each section. Sections, entry format, and promotion rules:
see the root [`../INSIGHTS.md`](../INSIGHTS.md).

---

## What Works

### 2026-08-01 · Component tests mock the hook module, not `fetch`

Trigger:  deciding how to isolate a component that loads data
Cause:    every component reads data through `src/lib/hooks/*`, so mocking the hook module is
          both smaller and closer to the seam. Mocking `fetch` re-tests `api.ts` for no gain.
Takeaway: `vi.mock("…/lib/hooks/<domain>", …)` and render inside `NextIntlClientProvider` with
          the real `messages/en/*.json`, so a missing translation key fails the test instead of
          silently rendering the key.
Evidence: src/lib/hooks/
Status:   → promoted to `docs/component-anatomy.md`

## What Doesn't Work

_None yet._

## Codebase Patterns

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

### 2026-08-01 · There is no landing page — `/` is a redirect

Trigger:  writing anything that assumes a stable home screen
Cause:    `src/app/page.tsx` redirects to the first repo's PR list, and falls back to
          `/onboarding` when the repo list is empty. What you see depends entirely on DB state.
Takeaway: never assert on "the home page". Browser flows that follow the redirect implicitly
          depend on which repo happens to be first — see `../e2e/INSIGHTS.md`.
Evidence: src/app/page.tsx
Status:   → promoted to `CLAUDE.md` (Gotchas)

## Tool & Library Notes

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
