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

### 2026-08-30 · A flow that asserts only seeded rows passes while proving nothing about the click it just made

Trigger:  the first version of `11-eval-pipeline` clicked "Turn into eval case" on an accepted
          finding and on a dismissed one, then waited for the case rows on the agent's Evals
          tab. Green, 11 flows of 11.
Cause:    the seed already writes eight cases for that agent, so those rows render whether or
          not either click did anything at all. The flow waited for a state that existed
          before it started, which is indistinguishable from the state it was meant to create.
          A broken button, a failed request and a perfect run all produce the same green.
Takeaway: after a mutating click, assert the thing that MOVED — here the case count going
          8 to 10 — never the presence of something the seed guarantees. A seeded fixture makes
          this especially easy to get wrong, because the screen looks right in every case. It
          is the browser-lane form of the rule in root `CLAUDE.md`: a green is not a result
          until you check what the run actually changed.
Evidence: e2e/specs/11-eval-pipeline.flow.json
Status:   resolved — the flow now waits for the moved count rather than the seeded rows

## Codebase Patterns

_None yet._

## Tool & Library Notes

_None yet._

## Recurring Errors & Fixes

### 2026-08-23 · `find role button --name` needs a name that is unique — a repeated control has to be labelled by what it points at

Trigger:  extending `09-pr-smart-diff` to click a severity badge on a diff line, where the
          seeded PR renders four of them and the design draws each as the same word
Cause:    the entry below rules out `find text … click` for a button, which leaves
          `--name`; but the component's first draft gave every badge the same aria-label
          ("Open this finding in the Findings tab"), so the locator could only ever mean
          "whichever the runner picks first" — deterministic today, and silently pointing
          at a different finding the moment the smart diff's ordering changes.
Takeaway: when a flow must click ONE of N identical controls, fix it in the COMPONENT, not
          the flow: give the control a name carrying the thing it acts on ("Open the
          suggestion on line 28 in the Findings tab"). The flow then reads as an assertion
          about which one, the label is better for a screen reader, and a component test
          can pin the exact string the flow depends on.
Evidence: e2e/specs/09-pr-smart-diff.flow.json;
          client/src/components/diff-viewer/CodeLine/CodeLine.tsx;
          client/messages/en/shell.json (diffViewer.openFinding)
Status:   resolved

### 2026-08-06 · `find text … click` misses a tab; buttons need `find role button --name`

Trigger:  `08-skills` passed every step up to `find text Preview click`, which failed with
          "Command failed" even though the Preview tab was visibly on screen
Cause:    the `Tabs` kit component renders each tab as a `<button>` containing an icon plus a
          text node. `find text` resolves a text node and clicks that, which is not the
          interactive element; the flows that already click controls
          (`04-pr-findings`, and the repo switcher) all use
          `find role button click --name "…"` instead.
Takeaway: `find text … click` for a row or a card, `find role button click --name` for
          anything that is really a button — tabs included. When a click step fails on an
          element you can see, check what the component actually renders before assuming a
          timing problem.
Evidence: e2e/specs/08-skills.flow.json, client/src/vendor/ui/kit/Tabs.tsx
Status:   resolved

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
