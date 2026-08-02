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

### 2026-08-01 · There is no landing page — `/` is a redirect

Trigger:  writing anything that assumes a stable home screen
Cause:    `src/app/page.tsx` redirects to the first repo's PR list, and falls back to
          `/onboarding` when the repo list is empty. What you see depends entirely on DB state.
Takeaway: never assert on "the home page". Browser flows that follow the redirect implicitly
          depend on which repo happens to be first — see `../e2e/INSIGHTS.md`.
Evidence: src/app/page.tsx
Status:   → promoted to `CLAUDE.md` (Gotchas)

## Tool & Library Notes

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
