# Insights — e2e

Append-only, newest first within each section. Sections, entry format, and promotion rules:
see the root [`../INSIGHTS.md`](../INSIGHTS.md).

---

## What Works

### 2026-08-01 · `wait` is the assertion — do not add an assertion layer

Trigger:  looking for where a flow asserts anything
Cause:    `agent-browser` exits non-zero when a `wait --text` / `wait --url` condition never
          holds, and the runner fails the step on any non-zero exit. `lib/assert.ts` only adds
          optional stdout substring checks and result bookkeeping.
Takeaway: express an expectation as a `wait` step with a descriptive `label`, rather than
          scraping output and comparing it yourself.
Evidence: lib/assert.ts, run.ts
Status:   → promoted to `docs/flow-authoring.md`

## What Doesn't Work

_None yet._

## Codebase Patterns

_None yet._

## Tool & Library Notes

_None yet._

## Recurring Errors & Fixes

### 2026-08-02 · `wait --url` is not "the page is ready" — flows 04 and 05 clicked into a skeleton

Trigger:  the first `pnpm e2e:hermetic` run on a machine with a freshly installed
          `agent-browser`; flows 04 and 05 failed at *"open the PR row"* while 02, which clicks
          the same row, passed
Cause:    `wait --url /pulls` resolves the moment the route changes, and the PR list is fetched
          client-side after that. Flow 02 happened to be safe because it carries an extra
          `wait --text` before the click; 04 and 05 went straight from the URL check to
          `find text … click` and raced the query. `test-results/04-pr-findings-fail.png` shows
          it exactly: "Loading pull requests…" and four skeleton rows. Nothing was wrong with
          the app, and the flake had been latent since the flows were written.
Takeaway: `--url` asserts navigation only. Before the first `find … click` on a screen whose
          content is fetched, add a `wait --text` for something that only exists once the data
          has rendered. When a flow fails on an interaction step, read the `-fail.png` in
          `test-results/` before suspecting the code — a skeleton in the screenshot means a
          missing wait, not a bug.
Evidence: e2e/specs/04-pr-findings.flow.json; e2e/specs/05-pr-diff.flow.json
Status:   resolved — both flows now wait for the row before clicking it

### 2026-08-01 · Flows fail locally because the dev DB has more than one repo

Trigger:  `npm test` passing in CI but failing on flows 02 / 04 / 05 locally
Cause:    those flows start at `{BASE}/`, which redirects to the **first** repo. CI seeds an
          empty database so that is always `acme/payments-api`; a dev database usually has
          other imported repos, so the flow lands somewhere else and the text checks time out.
Takeaway: use `pnpm e2e:hermetic`, which boots its own isolated freshly-seeded stack on
          5433/3101/3100. Never "fix" it by resetting the dev volume.
Evidence: specs/02, specs/04, specs/05
Status:   → promoted to `CLAUDE.md` (Gotchas)

## Session Notes

_None yet._

## Open Questions

_None yet._
