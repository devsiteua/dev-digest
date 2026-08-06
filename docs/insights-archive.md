# Insights archive

Entries moved out of an active `INSIGHTS.md` to keep it under ~250 lines. Nothing here is
stale and nothing was rewritten on the way in — each entry is verbatim, under the section it
came from.

Two kinds of entry qualify:

- **`→ promoted`** — the lesson became a one-line rule in a `CLAUDE.md`. The rule is live;
  this file is where its reasoning is kept.
- **`resolved`, and belonging to work that has shipped** — the fix is in the code and
  guarded by a test. Kept because the *reason* is not in the diff.

An `open` entry never moves: the active file is read at the start of every session, and open
is what "still applies" means.

Moved from the root `INSIGHTS.md` on 2026-08-02 (2 entries) and 2026-08-06 (8 entries).
Sections match any `INSIGHTS.md` — see
[`../.claude/skills/engineering-insights/SKILL.md`](../.claude/skills/engineering-insights/SKILL.md)
— but within a section entries are **appended in the order they were archived**, not
newest-first. Do not re-sort: one pair here says "amends the entry below", and sorting by
date would separate them.

---

## What Doesn't Work

### 2026-08-04 · Inheriting a neighbouring column's aggregation rule — `cost` is additive, `score` and `findings` are not

Trigger:  the L01 mentor review: the PR-list COST column showed one run's cost where a sum
          across the review's agents was expected
Cause:    the column was built by mirroring `PrMeta.score` (latest-review-only), and the
          comment in `pulls/routes.ts` stated one justification for all three fields at once —
          *"summing would triple-count one defect found by three agents"*. That is true of
          defects and of the score derived from them, and false of money. `runReview()` creates
          one `agent_runs` row **per target agent**
          (`server/src/modules/reviews/service.ts`), so a three-agent review put a third of the
          bill in the column — and an arbitrary third, whichever agent finished last. The
          2026-08-02 "Two severity tallies" entry (still in the active file) already warned
          that a third surface must pick its rule on purpose; COST is exactly the surface that
          copied the nearest neighbour instead.
Takeaway: before reusing the aggregation of the column next door, ask whether the quantity is
          additive. Counts of one event double-count across agents; money, tokens and durations
          do not — each run is a separate expenditure. A comment that covers several fields in
          one breath is where this hides: state the rule per field, or the field it does not fit
          inherits it silently. Note the follow-on for sums: `null` is *unknown*, so one
          unpriced run must poison the whole total to `—` rather than let a partial sum pass as
          exact.
Evidence: server/src/modules/pulls/routes.ts (`totalCostByPr`); specs/L01-run-cost.md
          (Decisions); server/test/reviews.it.test.ts ("PR list sums the cost of every done run")
Status:   resolved

## Codebase Patterns

### 2026-08-01 · The two `vendor/shared` trees have already diverged

Trigger:  comparing `server/src/vendor/shared` with `client/src/vendor/shared`
Cause:    there is no workspace and no build step keeping them in sync — they are two
          physical copies. Five files differ today. The server copy is ahead: it has
          `sessionId` on LLM options, `openrouter` in the `LLMProvider.id` union,
          `CommitFiles`, `AgentManifest`, and `AgentVersionConfig`.
Takeaway: harmless right now (the drift is confined to server-only ports the client never
          imports), but a contract edit **must** be applied to both copies. Diff them before
          committing anything under `vendor/shared`.
Evidence: server/src/vendor/shared vs client/src/vendor/shared
Status:   → promoted to `CLAUDE.md` (Gotchas)

### 2026-08-01 · An empty table in the schema is a future lesson, not dead code

Trigger:  `db/schema/` defines ~35 tables while the starter reads maybe a third of them
Cause:    the schema is intentionally complete from day 1 so lessons L01–L08 only ever add
          columns, never restructure. Same idea in `reviewer-core`: the `skills`, `memory`,
          and `specs` prompt slots exist and are simply never filled by the starter.
Takeaway: never "clean up" an unused table, contract, or prompt slot. Check the lesson table
          in `README.md` first.
Evidence: server/src/db/schema/
Status:   → promoted to `CLAUDE.md` (Gotchas)

### 2026-08-06 · A shape duplicated inside `vendor/shared` itself, not just across the two copies

Trigger:  adding `imported_file` to `SkillSource` in `contracts/knowledge.ts`, mirrored to the
          client copy — and the value still would not round-trip through a plugin export
Cause:    `contracts/productionize.ts` does not import `SkillSource`. `PluginSkill.source` has
          its OWN inline `z.enum([...])` with the same four members written out again. The
          mirror discipline everyone knows about is server-copy ⇄ client-copy; this is a
          second, quieter duplication *within* one copy, and nothing checks it.
Takeaway: after editing an enum or object in `vendor/shared`, grep the other contract files
          for its member names, not just for the symbol — an inline re-declaration will not
          show up in an import search. Left divergent here on purpose: `productionize.ts` is
          L08's file and is already drifted between the two trees, so widening the diff into
          it would have traded one debt for a worse one.
          Confirmed a second time on 2026-08-06 by the conventions extractor: `PluginConvention`
          (`productionize.ts:60-67`) re-declares the whole convention shape, `accepted: z.boolean()`
          included, so it did not move when `ConventionCandidate` gained `status`. Same file, same
          reason for leaving it — it is L08's, and already drifted between the two trees.
Evidence: server/src/vendor/shared/contracts/productionize.ts (PluginSkill.source, PluginConvention)
Status:   → promoted to `CLAUDE.md` (Gotchas). `PluginSkill.source` and `PluginConvention` stay
          behind their `knowledge.ts` originals until L08 touches that file

### 2026-08-02 · Correction: `PrMeta` needs `.nullish()` too, for a different reason

Trigger:  adding `findings_by_severity` to `PrMeta`, and reading the 2026-08-01 entry below,
          which says response-only contracts read straight from a table are free to use
          `.nullable()`
Cause:    that rule is incomplete. `PrMeta` is exactly such a shape, yet `.nullable()` would
          break it: `PrDetail = PrMeta.extend({...})` and `GET /pulls/:id` never emits the
          list-only fields at all. `.nullable()` requires the key to be *present*, so the
          detail endpoint would fail on a field it deliberately does not compute. That is why
          `score` and `cost_usd` are already `.nullish()` — the reason is structural, not the
          legacy-jsonb one.
Takeaway: before choosing `.nullable()`, check whether the schema is `.extend()`ed anywhere
          and whether every endpoint building the extended shape actually emits the field.
          The guard is cheap: `PrDetail.parse({...})` without the key, in `contracts.test.ts`.
Evidence: server/src/vendor/shared/contracts/platform.ts (PrMeta.findings_by_severity);
          server/test/contracts.test.ts
Status:   resolved — amends the entry below, which stays as written

### 2026-08-01 · A contract that also serializes a persisted jsonb doc needs `.nullish()`, not `.nullable()`

Trigger:  adding `cost_usd` to `RunStats` for L01, mirroring how the pre-removal code
          (commit `d45ab0d`) had declared it as `z.number().nullable()`
Cause:    `RunStats` is not only a response shape — it is the `stats` block **inside** the
          jsonb document stored in `run_traces.trace`, and rows written before the field
          existed have no `cost_usd` key at all. `.nullable()` requires the key to be
          present, so `GET /runs/:id/trace` would have 500'd on every historical run. The
          old code got away with `.nullable()` only because that field had been written
          since day one. Same trap waits on any future `RunStats`/`RunTrace` field.
Takeaway: before tightening or adding a field on `contracts/trace.ts`, ask whether old rows
          in `run_traces` carry it. If not, `.nullish()`. Response-only contracts read
          straight from a table (e.g. `RunSummary`) are free to use `.nullable()`.
Evidence: server/src/vendor/shared/contracts/trace.ts (RunStats.cost_usd);
          server/test/contracts.test.ts ("RunTrace parses a LEGACY stats block")
Status:   resolved — guarded by the legacy-stats fixture test

## Tool & Library Notes

### 2026-08-05 · `set -euo pipefail` turns a vanishing untracked file into a silently empty digest

Trigger:  `scripts/test-pr-self-review.sh` failed 3 cases, then 5, then 0 on identical input —
          every failure was a gate case expecting "allow"
Cause:    `scripts/pr-self-review-hash.sh` hashed untracked files with
          `git ls-files --others -z | xargs -0 -r shasum -a 256` inside a `pipefail` script. A
          worktree is live: the suite itself plants and removes untracked files, so a path can
          disappear between the listing and the hashing. `shasum` then exits non-zero, `pipefail`
          aborts the whole script, and it prints **nothing**. Callers that do
          `X="$(hash.sh || echo "")"` get an empty string and skip whatever it guards — in the
          gate's case, the entire staleness check, so a verdict recorded for a different diff
          would have sailed through without a word.
Takeaway: any pipeline over `git ls-files --others` needs `|| true`; the digest is worth more
          intact-minus-one-file than absent. And a consumer must distinguish "computed and
          differs" from "could not compute" — collapsing the second into the first is how a gate
          starts allowing silently. Reproduce with a background `rm` racing the hash.
Evidence: scripts/pr-self-review-hash.sh (untracked-file block); scripts/pr-self-review-gate.sh
          (the empty-`NOW_SHA` branch)
Status:   resolved

### 2026-08-05 · `git diff --name-status` letters are relative to the merge-base, not to HEAD

Trigger:  a check that only fires on a modified file would not fire when the file was demonstrably
          being modified — `server/.dependency-cruiser-known-violations.json` reported `A`
Cause:    the review base is `git merge-base HEAD origin/main`, and that file was created by a
          commit **on this branch**. Against the base it is an addition, and it stays one no
          matter how many later commits edit it. Every file a branch introduces behaves this way.
Takeaway: a status filter of `M` means "existed at the branch point", not "changed now". Rules
          about editing something that already shipped are correct with `M`; rules about content
          must accept `A` as well. To exercise an `M`-only rule from inside the branch that
          created the file, re-base the single case onto the commit that added it.
Evidence: scripts/pr-self-review-checks.sh (check 2, check 10); scripts/test-pr-self-review.sh
          (`BASE_OVERRIDE`)
Status:   resolved

### 2026-08-05 · A dependency-cruiser rule that matches nothing looks exactly like a rule that passes

Trigger:  the first onion-guard config reported "no violations" while `modules/pulls/routes.ts`
          was demonstrably importing `drizzle-orm`
Cause:    npm dependencies resolve to their on-disk path, `node_modules/drizzle-orm/index.cjs`,
          so `to: { path: '^drizzle-orm' }` matches no module. It must be
          `to: { dependencyTypes: ['npm'], path: 'node_modules/(drizzle-orm|postgres)/' }`.
          Two neighbouring traps: `to: { anyOf: [...] }` is not valid schema (split it into two
          rules, the CLI errors out), and a rule listing a module's own barrel — e.g.
          `repo-intel/index.ts` re-exporting `./routes.js` — fires a false positive unless
          `^src/modules/[^/]+/index\.ts$` is in `pathNot`.
Takeaway: never trust a green depcruise run you have not seen fail. Prove each new rule by
          planting a violation (`mkdir src/modules/__probe && echo "import { eq } from
          'drizzle-orm'" > src/modules/__probe/service.ts`), confirming exit code 1, then
          removing it. `pnpm arch:check:all` shows the frozen list for comparison.
Evidence: server/.dependency-cruiser-onion.cjs (header comment)
Status:   resolved

### 2026-08-02 · `defaultNow()` is transaction start time, so "newest row wins" can tie exactly

Trigger:  writing an integration test for "the PR list counts the latest review" and finding
          there was nothing safe to assert about *which* review wins
Cause:    Postgres `now()` — what `defaultNow()` compiles to — returns the **transaction's**
          start timestamp, not the statement's. Rows written in one transaction (three agents'
          reviews, a batch seed) therefore share `created_at` to the microsecond, and
          `orderBy(desc(createdAt))` + "first row wins" degenerates into planner order. No
          column can break the tie by recency either: every id in this schema is
          `uuid().defaultRandom()`.
Takeaway: for any "latest per group" read, add `desc(<pk>)` as a secondary sort key. It does not
          make the pick *correct* — it makes it **stable**, which is the property a test can
          assert ("two identical requests return the same tally") and the one users notice.
          Real ordering under a tie needs `clock_timestamp()` or a monotonic column, i.e. a
          migration.
Evidence: server/src/db/schema/_shared.ts:9; server/src/modules/pulls/routes.ts;
          server/test/reviews.it.test.ts ("two reviews share a timestamp")
Status:   → promoted to `CLAUDE.md` (Gotchas) on 2026-08-06, after the conventions repository
          needed the same secondary sort key. Ordering correctness under a tie is still
          deferred to a migration.

---

Only the **root** `INSIGHTS.md` has needed spilling so far. `server/INSIGHTS.md` is the next
candidate — 208 lines after L02 session 3 — but every entry in it is still `open` or newer
than the lesson it belongs to, so nothing qualifies yet.
