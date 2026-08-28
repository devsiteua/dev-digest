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
`CLAUDE.md` and is marked `→ promoted` here.

**Archiving rule:** keep each file under ~250 lines. Over budget, spill to
[`docs/insights-archive.md`](docs/insights-archive.md) — verbatim, under the same section, and
leave a `> Archived …` blockquote at the foot of the section listing the dates that left, so a
grep for a cited date still lands on a pointer. Only `→ promoted` and `resolved` entries whose
lesson has shipped qualify. An `open` entry never moves, and neither does a resolved one an
open entry points at ("the entry below") — the pair stays whole.

---

## What Works

_None yet._

> Archived 2026-08-29 → [`docs/insights-archive.md`](docs/insights-archive.md), verbatim under
> this section: 2026-08-28, 2026-08-07. What stays here is `open`, plus any resolved entry an
> open one points at.

## What Doesn't Work

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

> Archived 2026-08-06: *inheriting a neighbouring column's aggregation rule* (2026-08-04,
> resolved with L01's cost column) → [`docs/insights-archive.md`](docs/insights-archive.md).

> Archived 2026-08-29 → [`docs/insights-archive.md`](docs/insights-archive.md), verbatim under
> this section: 2026-08-28 ×2, 2026-08-25, 2026-08-24, 2026-08-23, 2026-08-22 ×2, 2026-08-02.
> What stays here is `open`, plus any resolved entry an open one points at.

## Codebase Patterns

### 2026-08-28 · Three silent narrowings sit between a real call site and a row in the blast map

Trigger:  the demo PR's map shows `tests/authorization.test.ts:34` as a caller of
          `canViewOrder` — but the file also calls it at line 39, and that row is absent.
Cause:    three independent filters, none of which announces itself.
          (a) `resolveReferences` (`repository.ts`) sets `references.decl_file` only when a
          `file_edges` row exists from referencing to declaring file, the declaring file
          EXPORTS that exact name, and there is exactly one candidate (`HAVING count(*) = 1`)
          — so a call through a barrel is never attributed and an ambiguous name is dropped
          rather than guessed.
          (b) `getResolvedCallers` INNER JOINs `file_rank`, so a caller file with no rank row
          is invisible; that only bites on a partial index, which is what `status: 'partial'`
          exists to say.
          (c) the de-duplication key is `file|ENCLOSING SYMBOL|toSymbol`, and the enclosing
          symbol falls back to the file's basename when the caller file has no `symbols`
          rows. A test file the indexer never parsed therefore collapses ALL its references
          to one row, whatever line they are on.
Takeaway: the map is precision-first by construction: a row in it is a real call, but its
          absence is not evidence of no call. Do not "fix" a missing caller downstream — the
          three rules above are where the answer is, and (c) in particular means a caller
          count from a symbol-less file is a count of FILES, not of call sites.
Evidence: server/src/modules/repo-intel/repository.ts (resolveReferences, getResolvedCallers);
          server/src/modules/repo-intel/service.ts (enclosingFromRows, the seenCaller key)
Status:   open — (c) is a real under-count; correcting it means keying on the line when the
          enclosing symbol is unknown, which no consumer needs yet

### 2026-08-22 · The onion skill's own review checklist ends on a question `arch:check` cannot answer

Trigger:  writing `architecture-reviewer`'s procedure on top of
          `.claude/skills/onion-architecture/tooling.md` § "Review checklist for a backend diff"
Cause:    item 9 of that checklist is *"Does `pnpm arch:check` still exit 0?"*. It does — even
          when a cross-module import was just added, because `no-cross-module-import` is
          declared `severity: 'warn'` in `server/.dependency-cruiser-onion.cjs:96`, and
          dependency-cruiser exits 0 on warnings. `server/INSIGHTS.md` (2026-08-06) already
          records the exit-code half of this, but nothing connects it back to the checklist
          that a reviewer is told to follow, so the skill quietly instructs you to run a test
          that cannot fail for the rule it is most likely to catch.
Takeaway: read the **output** of `pnpm arch:check`, never its exit code, and treat checklist
          item 9 as "did the output stay empty". Anything automated that gates on this — a
          hook, a CI step, an agent's `Verify:` line — has the same defect unless it greps the
          output. `pnpm arch:check:all` (no `--ignore-known`) is the version that also surfaces
          the frozen debt in `server/.dependency-cruiser-known-violations.json`.
Evidence: .claude/skills/onion-architecture/tooling.md § "Review checklist for a backend diff"
          item 9; server/.dependency-cruiser-onion.cjs:96-98; server/package.json:11-12
Status:   open — the skill is hand-authored and ours to edit, but changing a review checklist
          is its own decision; `architecture-reviewer.md` § Step 1 states the correction instead

### 2026-08-12 · Nothing persisted attributes a finding — or a run — to a SKILL, so every per-skill metric in the design is an agent-level approximation

Trigger:  building the skill editor's Stats tab from the design, which asks for USED BY, PULL
          FREQUENCY, ACCEPT RATE and FINDINGS (30D) per skill
Cause:    the chain stops one level short. `findings.review_id → reviews.agent_id` is the only
          producer link there is; `findings` has no skill column, `agent_runs` has no skill
          column and no agent VERSION either, and `agent_skills` records no timestamp. So an
          agent carrying three skills yields identical numbers under all three, and a run from
          before the attachment still counts. `run_traces.trace.prompt_assembly.skills` is a
          rendered STRING and the run log names the included skills in prose — neither is a
          queryable record of which skill ids a prompt carried.
Takeaway: any "how is this skill doing" number is attribution to the AGENTS that carry it —
          say so on screen, never average it into something that reads as the skill's own
          score, and drop the metrics that cannot be honest at all (PULL FREQUENCY was dropped
          for exactly this; RUNS (30d) took its place). Making it real needs a persisted
          skill↔run link, which is L06's eval pipeline, not a smarter query.
Evidence: server/src/db/schema/reviews.ts (findings); server/src/db/schema/runs.ts;
          server/src/vendor/shared/contracts/knowledge.ts (SkillStats);
          specs/L02-skills.md § Round 2 → Decisions
Status:   open — the approximation ships with an on-screen caveat until L06

### 2026-08-06 · `FEATURE_MODELS` says its defaults "mirror each module's constants" — for `conventions` there is no module to mirror

Trigger:  picking the model for the conventions extractor, and reaching for
          `resolveFeatureModel(container, ws, 'conventions')` because that is the function with
          the obvious name
Cause:    the registry's own doc comment (`contracts/platform.ts:31-36`) promises "the defaults
          MIRROR each module's constants, so behaviour is unchanged until a model is explicitly
          picked". Four of the five entries are `gpt-4.1` or a deepseek flash. `conventions` is
          `openai / gpt-5.4` — the priciest default in the file — and it mirrors nothing, because
          no conventions module existed to have a constant. `resolveFeatureModel` would have
          silently bought that model on every scan. The escape is already documented one file over
          (`modules/settings/feature-models.ts:30-35`: "callers that keep their own dynamic default
          (e.g. conventions) use this directly"), but it reads as a style note, not a bill.
Takeaway: for a feature whose module is being written now, `getFeatureModelOverride` + a
          module-local constant — never `resolveFeatureModel`. Check the registry's default before
          trusting the "unchanged behaviour" promise: it only holds where the old constant exists.
          Note the registry is duplicated in `client/src/lib/feature-models.ts` (the client cannot
          import the runtime value), so the Settings row is already visible for features with no
          code behind them.
Evidence: server/src/vendor/shared/contracts/platform.ts:73-79;
          server/src/modules/settings/feature-models.ts:30-35; specs/L02-conventions-extractor.md
Status:   open — `resolveFeatureModel` still has no caller; the first one should re-check this

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

> Moved to [`docs/insights-archive.md`](docs/insights-archive.md), which keeps their reasoning:
> on **2026-08-02**, two promoted entries from 2026-08-01 — *the two `vendor/shared` trees have
> already diverged* and *an empty table in the schema is a future lesson*; on **2026-08-06**,
> *a shape duplicated inside `vendor/shared` itself* (promoted) and the two `.nullish()` /
> `.nullable()` entries (2026-08-02 + 2026-08-01, resolved and test-guarded, and they read as
> one pair — the second amends the first, so they moved together).
> Every rule they produced is live in `CLAUDE.md` (Gotchas).

> Archived 2026-08-29 → [`docs/insights-archive.md`](docs/insights-archive.md), verbatim under
> this section: 2026-08-28, 2026-08-23, 2026-08-21, 2026-08-02. What stays here is `open`,
> plus any resolved entry an open one points at.

## Tool & Library Notes

### 2026-08-06 · `seed.ts` never converges on rename: a skill dropped from `SEED_SKILLS` survives, still linked, and its checklist is still in the prompt

Trigger:  splitting the seeded `api-contract-compat` skill into `breaking-change` /
          `response-schema` / `semver-discipline`, and asking what `pnpm db:seed` does to a
          machine that already ran the old seed
Cause:    the seed is insert-only in **both** halves, and each half fails differently. The
          skill loop is guarded on *that skill's own absence*, so the three new rows do
          appear — but nothing deletes the row whose constant was removed, because the loop
          never enumerates what is in the table. The link loop is guarded on the agent having
          **no links at all** (`if (existingLinks.length > 0) continue`), so an agent that
          already carries one link gets none of the new ones. Net effect on a dev DB: the old
          monolithic skill is still attached and still enabled, the three replacements sit
          unattached on `/skills`, and the demo runs on exactly the prompt it was supposed to
          stop using — with no error anywhere. Fresh volumes and CI (`skills.it.test.ts` seeds
          an empty database) both look green, so nothing catches it.
Takeaway: the entry below classifies seed additions into "needs a fresh volume" and "upgrades
          in place". RENAMES are a third class that neither guard handles, and re-seeding
          cannot fix: write the manual steps into the doc that drives the demo
          (untick the old link, delete the old skill) rather than assuming `pnpm db:seed`
          converges. `docker compose down -v` is not the escape — it takes every imported
          repository with it. The same shape applies to any seeded row keyed by NAME:
          `SEED_AGENT_SKILLS`, `seedAgents`, `SEED_DEMO_PRS`.
Evidence: server/src/db/seed.ts (the `SEED_SKILLS` loop and the `existingLinks.length > 0`
          guard); docs/skills-control-experiment.md § Setup
Status:   open — a "delete rows whose name left the constant" pass would fix it properly, but
          it would also delete a user's hand-edited copy of a seeded skill

### 2026-08-06 · `StructuredRequest.timeoutMs` is a no-op on OpenRouter — the timeout is fixed when the client is constructed

Trigger:  the conventions extractor holds an HTTP request open for its single model call, so it
          asks for a generous `timeoutMs` (180 s) instead of the 60 s adapter default
Cause:    only `adapters/llm/{openai,anthropic}.ts` read `req.timeoutMs` (`withTimeout(...,
          req.timeoutMs ?? DEFAULT_TIMEOUT)`). `OpenRouterProvider` passes `opts.timeoutMs ??
          90_000` to the OpenAI SDK **constructor** and never looks at the request field —
          and `Container.buildLlm` builds it without `timeoutMs`. So on the provider that
          serves every default model in this repo (`openrouter / deepseek-v4-flash`), the real
          ceiling is 90 s per attempt × the SDK's 2 retries, whatever the caller asked for.
          The port declares the field for all three providers, which is what makes it look
          honoured.
Takeaway: a per-request timeout only binds on OpenAI/Anthropic. To change it for OpenRouter,
          pass `timeoutMs` where `container.buildLlm` constructs the provider — a per-call
          value would need the provider to apply it per request (`this.client.withOptions`),
          which it does not do today. Same asymmetry applies to `maxRetries`: OpenRouter reads
          `req.maxRetries` for SCHEMA reprompts, while network retries come from the SDK
          constructor.
Evidence: reviewer-core/src/llm/openrouter.ts:54; server/src/adapters/llm/openai.ts:66;
          server/src/platform/container.ts (buildLlm); server/src/modules/conventions/constants.ts
Status:   open — documented in the L02 spec's Risks; fix only if a scan actually times out

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

> Archived 2026-08-06 → [`docs/insights-archive.md`](docs/insights-archive.md): the three
> resolved `pr-self-review` / dependency-cruiser tooling entries from 2026-08-05 (*`set -euo
> pipefail` and the empty digest*, *`--name-status` letters are relative to the merge-base*,
> *a rule that matches nothing looks like a rule that passes*), and *`defaultNow()` is
> transaction start time* (2026-08-02), now a `CLAUDE.md` Gotcha.

> Archived 2026-08-29 → [`docs/insights-archive.md`](docs/insights-archive.md), verbatim under
> this section: 2026-08-28 ×4, 2026-08-25, 2026-08-22 ×2, 2026-08-06. What stays here is
> `open`, plus any resolved entry an open one points at.

## Recurring Errors & Fixes

_None yet._

## Session Notes

_None yet._

## Open Questions

_None yet._
