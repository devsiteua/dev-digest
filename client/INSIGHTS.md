# Insights — client

Append-only, newest first. Format and promotion rules: see the root
[`../INSIGHTS.md`](../INSIGHTS.md).

---

## 2026-08-01 · There is no landing page — `/` is a redirect

Trigger:  writing anything that assumes a stable home screen
Cause:    `src/app/page.tsx` redirects to the first repo's PR list, and falls back to
          `/onboarding` when the repo list is empty. What you see depends entirely on DB state.
Takeaway: never assert on "the home page". Browser flows that follow the redirect implicitly
          depend on which repo happens to be first — see `../e2e/INSIGHTS.md`.
Status:   → promoted to `CLAUDE.md` (Gotchas)

## 2026-08-01 · Component tests mock the hook module, not `fetch`

Trigger:  deciding how to isolate a component that loads data
Cause:    every component reads data through `src/lib/hooks/*`, so mocking the hook module is
          both smaller and closer to the seam. Mocking `fetch` re-tests `api.ts` for no gain.
Takeaway: `vi.mock("…/lib/hooks/<domain>", …)` and render inside `NextIntlClientProvider` with
          the real `messages/en/*.json`, so a missing translation key fails the test instead of
          silently rendering the key.
Status:   → promoted to `docs/component-anatomy.md`
