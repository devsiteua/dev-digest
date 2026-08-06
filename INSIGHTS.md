# Insights — cross-package

Append-only. One entry per thing that surprised us, cost us time, or turned out not to be
what it looked like. Package-specific findings go in that package's `INSIGHTS.md`; this file
is only for what spans packages or the repo as a whole.

Written and read by the `engineering-insights` skill — see
[`.claude/skills/engineering-insights/SKILL.md`](.claude/skills/engineering-insights/SKILL.md).

## Sections

Every `INSIGHTS.md` in this repo carries the same seven sections, in this order. An empty one
stays, marked `_None yet._`, so there is always a place to append.

| Section | For |
|---|---|
| What Works | an approach that was tried and held up — reuse it |
| What Doesn't Work | a dead end or antipattern. **Most valuable, most often left empty** |
| Codebase Patterns | a convention or architectural decision the code does not announce |
| Tool & Library Notes | a quirk of a dependency, CLI, or the local environment |
| Recurring Errors & Fixes | a symptom seen more than once, with its fix |
| Session Notes | a dated summary, only when no single entry captures the session. Sparingly |
| Open Questions | left unresolved, so the next session does not re-derive it |

## Entry format

Newest first within a section.

```markdown
### YYYY-MM-DD · One-line title
Trigger:  what we were doing / what we saw
Cause:    what was actually going on
Takeaway: what to do differently next time
Evidence: path/to/file.ts:LINE
Status:   open | resolved | → promoted to <file>
```

An entry must be **non-obvious**, **specific** (names a file, symbol, or number),
**actionable cold**, and **durable**. "Be careful with async" is noise, not a lesson.

**Promotion rule:** an entry that saves us twice becomes a one-line rule in the relevant
`CLAUDE.md` and is marked `→ promoted` here. Keep each file under ~250 lines; once promoted
entries pile up, move them to `docs/insights-archive.md`.

---

## What Works

_None yet._

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
          2026-08-02 "Two severity tallies" entry below already warned that a third surface must
          pick its rule on purpose; COST is exactly the surface that copied the nearest
          neighbour instead.
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

### 2026-08-02 · Building a screen from design screenshots — the prototype's source says things a PNG cannot

Trigger:  re-doing the L01 severity feature against the unpacked design prototype, after
          round 1 had shipped from two screenshots of it
Cause:    three of the five gaps were invisible in a still image. Both counter surfaces open a
          hover popover listing the findings behind the numbers
          (`src/12-prdetail_runs.jsx:38-54`); the chip row *rests* with all three severities
          active (`src/10-findings.jsx:105`), and a screenshot of that is indistinguishable
          from a screenshot taken after one click; and the counters are bare text on a dotted
          rule, which at screenshot scale reads as a filled pill. A fourth trap runs the other
          way — `FindingsPanel` is defined in the prototype but mounted on **no** screen
          (`src/main.jsx` renders only Overview / Agent runs / Files changed), so a component
          existing there is not evidence it belongs anywhere.
Takeaway: get the prototype's source before building, and ask for it when only images are
          offered — the redo cost more than the original build. Grep `src/main.jsx` for what is
          actually mounted, then read the screen file end to end: hover states, empty states
          and resting states live in the source and nowhere else.
Evidence: DevDigest-Design-unpacked/src/{10-findings,12-prdetail_runs,14-screen_dashboard,main}.jsx
Status:   resolved for L01 — applies to every remaining lesson

### 2026-08-01 · Docs drift found during the first full repo walkthrough

Trigger:  onboarding pass over the whole repository
Cause:    three statements in committed docs no longer match the code —
          (1) `README.md` and `server/README.md` say `DEVDIGEST_CLONE_DIR` defaults to
              `./clones`, but `server/src/platform/config.ts` defaults to
              `~/.devdigest/workspace`;
          (2) `TESTING.md` says `server/package.json` is `skip-worktree`, but no
              skip-worktree flag is set (`git ls-files -v` is clean);
          (3) `.gitignore` carries exceptions for `agent-runner/dist/`, and that package
              does not exist in the starter (it returns in L06).
Takeaway: treat prose in READMEs as a hypothesis, verify against code before acting on it.
          None of these are blocking, but each can burn twenty minutes.
Evidence: server/src/platform/config.ts
Status:   open — fix opportunistically when touching those files

## Codebase Patterns

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
Evidence: server/src/vendor/shared/contracts/productionize.ts (PluginSkill.source)
Status:   open — `PluginSkill.source` is narrower than `SkillSource` until L08 touches it

### 2026-08-05 · One dependency-cruiser run over `server/src` also polices `reviewer-core`'s purity

Trigger:  wiring the onion guard and expecting to need a second config inside `reviewer-core`
          (which has no dependency-cruiser of its own — it installs with npm, not pnpm)
Cause:    `tsConfig: { fileName: 'tsconfig.json' }` makes the cruise follow the
          `@devdigest/reviewer-core` path alias, so `../reviewer-core/src/**` shows up as
          ordinary modules in the same graph (149 modules, 463 dependencies, ~1 s). Rules keyed
          on `from: { path: 'reviewer-core/src' }` therefore work from `server/`. The same is
          true of `@devdigest/shared`. This is why the CI step sits in the `typecheck` job of
          `server-unit.yml`, after the `npm ci` that installs reviewer-core's deps — without
          them the alias resolves but `openai` does not, and the graph quietly changes shape.
Takeaway: cross-package architecture rules go in `server/.dependency-cruiser-onion.cjs`, not in
          a new per-package config. `pnpm arch:check` ignores the 16 frozen violations in
          `.dependency-cruiser-known-violations.json`; never append to that file to unblock a
          change — it is the debt list, and anything new must fail.
Evidence: server/.dependency-cruiser-onion.cjs; .github/workflows/server-unit.yml (typecheck job)
Status:   open — baseline shrinks as touched files are fixed

### 2026-08-05 · `allowed-tools` in a skill narrows the session's tools — advisory skills must omit it

Trigger:  drafting frontmatter for the hand-authored `frontend-architecture` skill and copying
          `allowed-tools` from `engineering-insights` because it looked like house style
Cause:    `allowed-tools` restricts what may be used *while the skill is active*, so it splits
          hand-authored skills into two kinds. `engineering-insights` is procedural — it runs, edits
          `INSIGHTS.md`, and finishes — so `Read, Edit, Grep, Glob` is correct and protective. An
          advisory skill is loaded **in the middle of someone else's implementation**; declaring
          `Read, Grep, Glob` there would forbid `Write`/`Edit` at the exact moment the caller needs
          them. Only two skills on disk declare the field, and both are the procedural kind — the
          omission everywhere else is the convention, not an oversight.
Takeaway: declare `allowed-tools` only when the skill itself performs a bounded action. Leave it out
          for reference skills. Unknown frontmatter keys are tolerated, so a `version:` can be added
          freely — `typescript-expert` already carries `category`, `risk`, `source`, `date_added`.
Evidence: .claude/skills/engineering-insights/SKILL.md vs
          .claude/skills/frontend-architecture/SKILL.md; .claude/skills/typescript-expert/SKILL.md
Status:   open — applies to every skill authored from here on

### 2026-08-02 · Two severity tallies with different rules now coexist, deliberately

Trigger:  adding the PR-header scoreboard to a product whose PR list already had a FINDINGS
          column, and having to answer "which findings does this number count?" twice
Cause:    they cannot be the same rule. The list column counts the **latest review only** — it
          sits beside a SCORE ring describing exactly one review, and summing runs there would
          triple-count one defect three agents each found. The header counts **every finding on
          the PR** — it sits above the accordions listing those findings and must match the
          "Agent runs" tab count, which is what "the counters agree with the list" means.
Takeaway: a third surface must pick one on purpose, not by copying whichever neighbour is
          closer. The server's rule (newest `kind='review'`, summaries excluded) has a client
          twin in `latestReviewFindings` (`client/src/lib/findings.ts`) precisely so the PR-list
          hover popover cannot list findings the numbers above it never counted — keep the two
          in step if either changes.
Evidence: server/src/modules/pulls/routes.ts; client/src/lib/findings.ts;
          client/.../[number]/_components/PrSeveritySummary/PrSeveritySummary.tsx
Status:   open

### 2026-08-02 · A feature cut from the starter leaves its scaffold behind — grep before building

Trigger:  building the L01 findings-severity counters, expecting a from-scratch feature
Cause:    every removed feature was cut at the leaves, not at the root. Waiting in the tree
          before a line was written: `rollupSeverities()` + a `SeverityCounts` type in
          `pulls/status.ts`, pure and unit-tested with **no importers**; an unused `divider`
          style in `FindingsPanel/styles.ts`; `panel.noMatchBody` reading "Adjust the filters
          **above**" for filters that no longer existed; `toggleGroup` already carrying
          `marginLeft: auto` to leave room on the left; and a comment in `pulls/routes.ts`
          asserting the breakdown was *intentionally* withheld. Roughly half the feature was
          already there.
Takeaway: before starting any L02–L08 feature, grep for its vocabulary across `src/`,
          `messages/en/*.json` and the `styles.ts` files. An unused export, an orphan style,
          or copy referring to a control that does not exist is the removed feature's
          outline — and it encodes decisions already made. Also treat such comments as
          suspect: that `routes.ts` one described the cut, not a design position.
Evidence: server/src/modules/pulls/status.ts; client/.../FindingsPanel/styles.ts
Status:   open — expect the same on every remaining lesson

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

### 2026-08-02 · `@devdigest/ui` declares a fourth severity the API can never produce

Trigger:  building severity counters and wondering whether `INFO` needed a chip
Cause:    `vendor/ui/primitives/tokens.ts` types `Severity` as
          `CRITICAL | WARNING | SUGGESTION | INFO` and gives `INFO` a colour, icon and label,
          while the contract enum has only the first three. Two client constants maps carry
          an `INFO` bucket as well, and `FindingCard` casts the 3-value contract type to the
          4-value UI type. Nothing rejects `INFO` — it is simply unreachable, because Zod
          would refuse it on the way in.
Takeaway: iterate severities from `SEVERITY_KEYS` (`client/src/lib/severity.ts`), never from
          `Object.keys(SEV)` — the latter yields a level that is always zero. In a file
          importing both, alias one of the two `Severity` types. `vendor/ui/**` is
          do-not-touch, so the divergence is permanent.
Evidence: client/src/vendor/ui/primitives/tokens.ts:3; client/src/lib/severity.ts
Status:   open — harmless as long as nothing enumerates the UI type

### 2026-08-02 · e2e flows assert seed literals, so `seed.ts` is part of their contract

Trigger:  adding findings to the demo review, from the server package
Cause:    `e2e/specs/04-pr-findings.flow.json` waits on the literal strings `"2 findings"` and
          `"Hardcoded Stripe secret key in commit"`. Neither `seed.ts` nor anything in
          `server/` mentions this; the coupling is only visible from the e2e side. Changing
          the number of seeded findings silently breaks a flow in another package.
Takeaway: after editing `server/src/db/seed.ts`, grep `e2e/specs/*.json` for the values you
          changed. Note also that flows follow the home redirect to the **first** repo, so
          they need a freshly seeded single-repo DB — the dev DB will not do.
Evidence: e2e/specs/04-pr-findings.flow.json; server/src/db/seed.ts
Status:   open

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

> Two promoted entries from 2026-08-01 — *the two `vendor/shared` trees have already diverged*
> and *an empty table in the schema is a future lesson* — moved to
> [`docs/insights-archive.md`](docs/insights-archive.md) on 2026-08-02 to keep this file under
> ~250 lines. Both are live rules in `CLAUDE.md` (Gotchas); the archive keeps their reasoning.

## Tool & Library Notes

### 2026-08-06 · Drizzle's `text(name, { enum })` emits a bare `text` column — widening an enum needs no migration

Trigger:  L02 needed a fifth `SkillSource` (`imported_file`) and the plan budgeted a migration
          for it, on the assumption that the enum was enforced in the database
Cause:    `text('source', { enum: [...] })` is a TYPE-level narrowing only. `0000_init.sql`
          defines the column as plain `"source" text NOT NULL`, and `grep -c CHECK` over that
          file returns 0 — the schema has no CHECK constraint anywhere. Nothing in Postgres
          knows the allowed values, so adding one is a TypeScript edit plus the matching Zod
          enum, and `git status src/db/migrations` stays clean.
Takeaway: before planning a migration for an enum change, check whether the column is a real
          PG enum or a `text` with a TS-side `{ enum }`. In this repo it is always the latter.
          The corollary is the warning: an existing row can hold a value the enum no longer
          lists, and only the Zod parse at the edge will notice — so NARROWING one is the
          change that needs care, not widening.
Evidence: server/src/db/schema/skills.ts:13, server/src/db/migrations/0000_init.sql:316
Status:   resolved

### 2026-08-06 · `/pr-self-review --override` cannot unblock a scripted CRITICAL, though both the skill and the checks say it can

Trigger:  L02 ended with three scripted CRITICALs, all verified false positives — a
          user-authorised `vendor/ui/nav.ts` edit, a contract mirror whose two copies are now
          byte-identical, and a schema change `pnpm db:generate` confirms needs no migration
Cause:    `scripts/pr-self-review-gate.sh` section 3 re-runs the checks and `exit 2`s on any
          CRITICAL **before** it ever opens `last-verdict.json`. The override lives in that
          file and is only consulted in section 6, which section 3 never reaches. So the
          escape hatch the checks themselves advertise ("or run: /pr-self-review --override")
          does nothing for the findings that print it. Verified by feeding the gate a
          `gh pr create` payload: exit 2 with an override recorded.
Takeaway: for a scripted CRITICAL there are only two real options — change the code so the
          check stops firing (the right answer for the secret-literal one: a test fixture did
          not need a credential-shaped string), or `DEVDIGEST_SKIP_PR_REVIEW=1`. Three of the
          twelve checks are heuristics that cannot see intent: `check:contract-mirror`
          compares changed LINES, so repairing pre-existing drift on one side trips it even
          though the files end up identical; `check:schema-migration` cannot tell a DDL change
          from a TS-only enum widening. Either teach section 3 about the override, or stop
          suggesting it there.
Evidence: scripts/pr-self-review-gate.sh:60-78, .claude/skills/pr-self-review/SKILL.md §7
Status:   open

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
Status:   resolved for stability; ordering correctness deferred to a migration

### 2026-08-02 · The seed now creates one `agent_run`, and the guard that made it upgradeable

Trigger:  closing the entry below, so the timeline counters could be demoed at all
Cause:    the whole demo block sits inside `if (!pr)`, which only fires when PR #482 is
          created. Anything added there is invisible on an already-seeded database — the two
          extra findings this session added are exactly that. The new `agent_runs` row is
          instead guarded on *"this PR has no runs yet"*, so it backfills an existing dev DB
          without dropping the volume.
Takeaway: seed additions come in two flavours. Data attached to a row created by `if (!pr)`
          needs a fresh volume to appear — plan a reset, or the demo runs on stale data.
          Anything guarded on its own absence upgrades in place; prefer that shape. Also do
          **not** set `pullRequests.lastReviewedSha` while seeding: `deriveReviewStatus` would
          flip #482 to `reviewed`, and the PR list opens on the `needs_review` filter, so the
          demo PR would disappear and take e2e flows 02/04/05 with it.
Evidence: server/src/db/seed.ts (the `existingRuns.length === 0` block)
Status:   resolved — supersedes the entry below

### 2026-08-01 · `pnpm db:seed` creates zero `agent_runs` — run-related UI cannot be eyeballed

Trigger:  booting `./scripts/dev.sh` to visually confirm the new run-cost column, timeline
          badge, and trace Stats tile
Cause:    the seed populates repos, PRs, agents, reviews, and findings, but **no** runs —
          `select count(*) from agent_runs` on a freshly seeded dev DB is 0. So the PR-list
          COST column, the Agent-runs timeline, and the run trace drawer all render their
          empty state no matter what you changed. Filling them needs a real review, which
          means a real API key and a billable model call.
Takeaway: for anything keyed off `agent_runs` or `run_traces`, the `*.it.test.ts` lane
          (testcontainers + `MockLLMProvider`, which reports usage and cost) is the
          verification — not a browser click-through. Don't burn time booting the stack.
Evidence: server/src/db/seed.ts; server/test/reviews.it.test.ts
Status:   open — seeding a demo run would make run UI reviewable without a model call

### 2026-08-01 · `skills-lock.json` does not describe the skills that are actually on disk

Trigger:  authoring the first hand-written skill, and needing to know whether editing
          anything under `.claude/skills/` breaks the "vendored from GitHub by hash" rule
Cause:    the lock and the tree have drifted in both directions. On disk but **not** locked:
          `mermaid-diagram`, `react-best-practices`, `react-testing-library`, `security`.
          Locked but **not** on disk: `architecture-patterns`, `github-workflow-automation`.
          Nothing inside a skill directory says which of the two it is.
Takeaway: `skills-lock.json` is the only authority on what is vendored — never infer it from
          the directory listing. Re-vendoring a skill silently overwrites hand edits, so a
          hand-authored skill must stay out of the lock.
Evidence: skills-lock.json vs .claude/skills/
Status:   open — the lock is stale in both directions; left untouched on purpose

## Recurring Errors & Fixes

_None yet._

## Session Notes

_None yet._

## Open Questions

_None yet._
