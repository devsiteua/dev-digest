# Insights — e2e

Append-only, newest first. Format and promotion rules: see the root
[`../INSIGHTS.md`](../INSIGHTS.md).

---

## 2026-08-01 · Flows fail locally because the dev DB has more than one repo

Trigger:  `npm test` passing in CI but failing on flows 02 / 04 / 05 locally
Cause:    those flows start at `{BASE}/`, which redirects to the **first** repo. CI seeds an
          empty database so that is always `acme/payments-api`; a dev database usually has
          other imported repos, so the flow lands somewhere else and the text checks time out.
Takeaway: use `pnpm e2e:hermetic`, which boots its own isolated freshly-seeded stack on
          5433/3101/3100. Never "fix" it by resetting the dev volume.
Status:   → promoted to `CLAUDE.md` (Gotchas)

## 2026-08-01 · `wait` is the assertion — do not add an assertion layer

Trigger:  looking for where a flow asserts anything
Cause:    `agent-browser` exits non-zero when a `wait --text` / `wait --url` condition never
          holds, and the runner fails the step on any non-zero exit. `lib/assert.ts` only adds
          optional stdout substring checks and result bookkeeping.
Takeaway: express an expectation as a `wait` step with a descriptive `label`, rather than
          scraping output and comparing it yourself.
Status:   → promoted to `docs/flow-authoring.md`
