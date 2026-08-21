# L02 — Conventions extractor

Status: done
Owner: —
Packages touched: server, client

## Goal

A user can point DevDigest at an imported repo and get back a list of the house
rules that repo already follows — each one quoting the lines that prove it — then
accept, reject or reword them and merge the survivors into a single skill any
agent can be given. The rule an experienced reviewer would have written by hand
(the seeded `no-then-chains` skill is exactly that artifact) is produced from the
code instead.

## Context

The other half of the L02 line in [`README.md`](README.md); `L02-skills.md`
§ Out of scope defers it explicitly. Skills shipped first on purpose — the
extractor's whole output is a skill, so there was nothing to write into until
`/skills` existed.

Almost every piece is already in the tree and unwired, which is the
"grep before building" pattern in the root `INSIGHTS.md` for the third lesson
running:

| Piece | Where | State before this spec |
|---|---|---|
| `conventions` table | `server/src/db/schema/knowledge.ts` | empty, no readers, no writers, no index |
| `ConventionCandidate` | `contracts/knowledge.ts` (both copies) | declared, imported nowhere |
| `skills.source='extracted'`, `skills.evidence_files` | `server/src/db/schema/skills.ts` | ready |
| `repoIntel.getConventionSamples(repoId, n)` | `modules/repo-intel/service.ts` | implemented, zero callers |
| feature-model id `conventions` | `contracts/platform.ts` | already a row in Settings |
| `getFeatureModelOverride` | `modules/settings/feature-models.ts` | zero callers in the repo |
| `messages/en/conventions.json`, `shell.json` `nav.conventions` | `client/messages/en/` | complete, unused |
| `activeKeyFor()` mapping `/conventions` | `client/src/components/app-shell/helpers.ts` | maps a route that does not exist |
| `convention` colour, `extracted` icon | `client/src/lib/skills.ts` | ready |

Design: screen key `conventions` (N7) in the local design reference — cards with
evidence and a confidence bar, an accept/reject pair per card, and a "Create
skill from conventions" modal that merges the accepted ones. Nav key
`conventions`, icon `ListChecks`. The N8 Conformance Report shares that file and
is **not** part of this work.

Prompt/trust rules the merged skill inherits: `docs/agent-prompts/README.md`
§ "Skills / rules".

## In scope

- `server/src/modules/conventions/` (`routes` → `service` → `repository` +
  `helpers` + `constants`), plus one line in `modules/index.ts`:
  - `POST /repos/:id/conventions/extract` — sample, call the model once, verify,
    persist, return `ConventionExtractResult`. Rate-limited like `POST /pulls/:id/review`.
  - `GET  /repos/:id/conventions` — the stored candidates.
  - `PATCH /conventions/:id` — `ConventionUpdate` (reword, re-file, accept/reject).
  - `POST /repos/:id/conventions/skill` — `ConventionSkillRequest` → one skill,
    `source='extracted'`, `evidence_files` filled, accepted rows stamped with its id.
- Code-side sampling via `getConventionSamples`, file bodies read from the clone.
- One structured call, `schemaName: 'ConventionExtraction'`, against a
  module-local cheap-model default overridable per workspace.
- Code-side evidence verification, and a snippet re-read from the file.
- Contract: `ConventionStatus`, a reshaped `ConventionCandidate`,
  `ConventionDiscard`, `ConventionExtractResult`, `ConventionUpdate`,
  `ConventionSkillRequest` — in **both** `vendor/shared` copies.
- Schema: `accepted boolean` → `status text`, plus `category`,
  `evidence_start_line`, `evidence_end_line`, `created_at`, `skill_id`, a
  `(workspace_id, repo_id)` index, and NOT NULL on the evidence columns.
- Seed: three `pending` candidates for `acme/payments-api`, so the screen has a
  populated state on a seeded database — no index, no provider key, no model
  call. Guarded on their own absence, not on the demo PR's.
- Client: route `/repos/[repoId]/conventions`, a `NAV` entry with `href` +
  `gKey`, `lib/hooks/conventions.ts`, the candidate list with accept/reject/edit,
  and the merge-to-skill modal. `messages/en/conventions.json` extended where the
  merged-skill flow needs strings it does not have.
- e2e: a flow that renders the screen and its empty state without triggering a
  model call.

## Out of scope

- **The N8 Conformance Report.** It shares one file with N7 in the design and
  nothing else — different table (`conformance_checks`), different input (a PR
  against a spec), different lesson.
- **Importing conventions from a URL.** Same SSRF argument that kept skill
  import from URL out of `L02-skills.md`.
- **Versioning a candidate.** `skill_versions` snapshots the merged skill's body,
  which is the text that actually reaches a prompt; an edit history of the
  intermediate candidate buys nothing.
- **One skill per finding.** See Decisions.
- **Re-running extraction incrementally** (diffing a new pass against stored
  candidates). A re-scan replaces `pending` rows; `accepted` and `rejected` ones
  survive, and that is the whole merge strategy.
- **Syncing the four drifted `vendor/shared` files**, `contracts/productionize.ts`
  included — see Decisions.

### Future work

Quality of the found rules is deliberately left at "one honest pass":

- a **critic pass** that re-reads each candidate against a second sample and
  drops the ones it cannot re-derive;
- **ast-grep pre-signals** — mine `adapters/astgrep` for repeated syntactic
  shapes and hand the model evidence instead of asking it to find its own;
- **per-category quotas**, so twelve naming rules cannot crowd out the one
  error-handling rule that mattered.

Each is a real improvement and each changes the cost and the call shape. None is
needed to demonstrate the feature.

## Decisions

- **Sampling is code, so the model is called exactly once.**
  `getConventionSamples()` already ranks files and drops tests, configs and
  migrations, deterministically and for free. The comment at
  `server/src/adapters/mocks.ts:50` anticipates a two-step dialogue
  (`'ConventionFileSelection'` → `'ConventionExtraction'`) and `MockLLMOptions`
  carries `structuredBySchema` to support it; we decline it on purpose. The first
  call would only re-derive a ranking we already have — at double the price, with
  a different answer each run. Only `'ConventionExtraction'` is used.
- **The cheap model comes from a module-local constant, not the registry.**
  `FEATURE_MODELS`' default for `conventions` is `openai / gpt-5.4` — the most
  expensive default in the registry, and the row already visible in Settings.
  `resolveFeatureModel()` would silently pick it. So the module keeps its own
  default (`openrouter / deepseek/deepseek-v4-flash`) and asks only for the
  workspace's override via `getFeatureModelOverride()`. That is precisely the
  case the comment at `modules/settings/feature-models.ts:32` was written for —
  and this module is its first caller anywhere in the repo. The registry stays
  untouched, so a user who *has* picked a model still gets it.
- **Evidence is verified by code, and the stored snippet comes from the file.**
  A candidate survives only if its `evidence_path` is one of the sampled files
  and the clone yields a non-empty `[start, end]` range. What is persisted is the
  text read back from disk, never the model's rendition of it — otherwise a
  hallucinated snippet would be displayed under the label "detected in", which is
  the one thing this screen must never do. `git.readFile()` already exists for
  this; the line-range slice is a pure helper in the module.
- **Nothing is dropped silently.** Rules that fail the check go to
  `ConventionExtractResult.discarded` with a reason, and the sampled file list
  ships with the result. Three candidates with no explanation reads as "this repo
  has three conventions"; three candidates next to seventeen discards reads as
  what it is.
- **An unindexed repo is a 422 with an instruction, not an empty screen.**
  This spec first said the degraded path should render the empty state. It
  should not. `getConventionSamples` returns `[]` both for "indexed, nothing
  worth sampling" and for "never indexed" — and the second is the common one.
  Answering a deliberate click on *Run extraction* with "No conventions
  extracted yet" describes the outcome and hides the cause; the user's next
  action is to index the repo, and nothing on that screen would say so. So the
  service throws a `ValidationError` naming the repo and the fix. The property
  that actually mattered is kept and tested: **no model call is made**, and
  nothing is written. The empty state still belongs to the other empty case —
  an indexed repo with no stored candidates, which is what `GET` returns before
  the first scan.
- **Extraction is synchronous.** One call to a cheap model against a sample that
  code already chose, with no partial output worth streaming — a `JobRunner` job
  would add a status row and a polling loop, and SSE would add a subscription,
  to something with a single step. The microcopy already agrees
  (`conventions.json` has `page.scanning` = "Scanning…", a blocking state, not a
  live log). The cost is a long-held request; see Risks.
- **One merged skill, `repo-conventions`.** A skill per rule would multiply the
  prompt-block count by ten and make `MAX_SKILLS_CHARS` the thing that decides
  which house rules an agent sees. One skill also matches the design's modal,
  which merges the accepted cards into a single editable body.
- **A re-merge is a new version, not a name clash.** The default name is fixed,
  and merging is not a one-shot act — the user accepts three rules, merges,
  accepts two more and merges again. An insert-only path failed the second merge
  on `assertNameFree`, *after* the whole body had been composed. So
  `SkillsService.saveFromConventions` takes a `replaceId` and `repo.update`
  bumps `version` and snapshots the old body. What may be replaced is decided by
  `ConventionsService.replaceableSkillId`: the name must belong to an
  `extracted` skill that **this repo's own candidates already point at** via
  `skill_id`. Keying on the name alone would let two repos in one workspace
  overwrite each other under the shared default; keying on `skill_id` means the
  second repo still gets the 422 and renames, which is the correct answer
  because those are different house rules under the same title.
- **The server stamps `source`, exactly as for imports.**
  `ConventionSkillRequest` has no `source` and no `id`; the route writes
  `'extracted'` and fills `evidence_files` from `convention_ids`. Same reasoning
  as `SkillDraft` in `L02-skills.md`: a body a model wrote is not trusted text,
  and letting the caller name its own provenance is how it would escape
  `wrapUntrusted()`.
- **`status` is `text` plus a TypeScript narrowing; no CHECK constraint.**
  Drizzle's `text(name, { enum })` emits a bare `text` column — recorded in
  `INSIGHTS.md` (2026-08-06) and true of every enum in this schema. Adding a
  CHECK here would make `conventions` the only table with one.
- **Replacing `accepted boolean` with `status text` is safe, and only here.**
  The table has been empty since `0000_init.sql`, no migration has touched it,
  and grep finds zero readers and zero writers. That matters concretely: the
  generated migration contains `ADD COLUMN "category" text NOT NULL` with no
  default, which would fail outright on a populated table. A boolean cannot tell
  "nobody has looked at this yet" from "somebody looked and said no" — and a
  re-scan has to treat those differently, or every rejected rule comes back.
- **The evidence columns become NOT NULL** (`repo_id`, `evidence_path`,
  `evidence_snippet`, `confidence` were all nullable). A candidate without
  evidence is discarded rather than stored, so a nullable evidence column could
  only ever have meant "we lost it", and would have forced the repository to
  coalesce a missing proof into an empty string. `skill_id` stays nullable —
  `onDelete: 'set null'` requires it, and `null` there is a real state ("in no
  skill yet"), not a gap.
- **`ConventionStatus` is a named export, not an inline `z.enum`.** It is needed
  by both `ConventionCandidate` and `ConventionUpdate`, and the file's own
  convention (`SkillType`, `SkillSource`, `MemoryScope`) is to name enums. The
  2026-08-06 `INSIGHTS.md` entry on shapes duplicated *inside* `vendor/shared`
  is what an inline copy costs.
- **`PluginConvention` in `contracts/productionize.ts` keeps `accepted: z.boolean()`.**
  It is that same quiet second declaration — the convention shape written out
  again, in a file that does not import `ConventionCandidate`. It belongs to L08,
  it is already drifted between the two `vendor/shared` trees (its `provider`
  enum), and widening the diff into it would trade one debt for a worse one.
  Recorded here so the plugin export is known to be behind, not assumed current.
  (The other `accepted` hits — `observability.ts`, `productionize.ts:146` — are
  counts of accepted *findings* and unrelated.)
- **Evidence lines are two integers, not a suffix on the path.** The design's
  mock writes `src/api/users.ts:23-31`; the server has to slice a file with those
  numbers, so they are stored apart and rendered back into one string by the UI.
- **Request contracts live in `vendor/shared`.** `modules/skills/routes.ts`
  declares its bodies locally because they bind module constants
  (`MAX_BODY_CHARS`); these do not, and the root `CLAUDE.md` rule — a contract
  doubles as request validation and response schema — is the default.
- **The candidate's evidence is not user-editable.** `ConventionUpdate` covers
  `rule`, `category` and `status` only. Hand-typed evidence would still be
  labelled "detected in"; changing it means another extraction pass.

## Acceptance criteria

- [x] Running extraction on an indexed repo returns candidates, the list of files
      sampled, and every discarded rule with its reason.
- [x] Exactly one `completeStructured` call is made per extraction, with
      `schemaName: 'ConventionExtraction'`.
- [x] With no workspace override, the call uses the module's cheap default, not
      the `gpt-5.4` registry default; setting `feature_models.conventions` in
      Settings changes the model actually used.
- [x] A candidate whose `evidence_path` is not among the sampled files is
      discarded, and appears in `discarded` with a reason.
- [x] The stored `evidence_snippet` equals the file's lines
      `[evidence_start_line, evidence_end_line]`, even when the model returned
      different text for them.
- [x] Accept / reject / reword each persist, and a rejected candidate does not
      reappear after a re-scan.
- [x] Merging accepted candidates creates one skill named `repo-conventions`
      with `source='extracted'`, `evidence_files` listing their paths, and each
      merged candidate carrying the new `skill_id`.
- [x] `POST /repos/:id/conventions/skill` ignores a `source` sent in the body.
- [x] Merging the same repo again under the same name updates that skill and
      bumps its `version`, leaving one row and two `skill_versions`; a *different*
      repo merging under that name is refused with a 422 naming the skill.
- [x] After a pass, the screen states how many files were read, how many rules
      the model proposed, how many were kept and how many were discarded, and
      names the first few rejections with their reason.
- [x] **Degraded path:** an unindexed repo (or `repoIntelEnabled=false`) yields
      an empty sample, **no model call**, nothing written, and a 422 that says to
      index the repo first — see Decisions for why this is not the empty state.
- [x] **Degraded path:** a model reply in which every rule fails verification
      persists nothing and returns all of them as `discarded`.
- [x] Every route is workspace-scoped; a foreign `repo_id` or `convention_id` is
      a 404.
- [x] **Regression:** `pnpm arch:check` is green and the known-violations
      baseline is unchanged.
- [x] **Regression:** both `vendor/shared/contracts/knowledge.ts` copies are
      byte-identical.
- [x] **Regression:** an agent with no skills still produces a byte-identical
      prompt; the merged skill reaches a prompt only once attached and enabled.
      Pinned by `skills.it.test.ts` (no links ⇒ `prompt_assembly.skills` is null
      and the user message has no `## Skills / rules`; disabling a skill removes
      its block without touching the link) and confirmed live by the control
      experiment's unskilled arm — see `docs/skills-control-experiment.md`
      § Recorded result.

## Test plan

- **server unit** — `test/contracts.test.ts`: `ConventionCandidate` full parse,
  a boolean-era payload rejected, out-of-range confidence rejected,
  `ConventionSkillRequest` stripping `source` and refusing an empty
  `convention_ids`. `test/conventions-helpers.test.ts`: the line-range slice
  (1-based, clamped, empty range), the evidence check (path not sampled, range
  past EOF, whitespace-only slice). There is no merged-skill *body* builder on
  the server: the modal composes that text and the user edits it before
  `POST .../skill` receives it. What the server decides — and what the
  integration test pins — is `source`, `evidence_files`, and which candidates
  are eligible at all.
- **server `*.it.test.ts`** — `test/conventions.it.test.ts` with
  `MockLLMProvider`: one call and its `schemaName`; the model choice with and
  without a workspace override; persistence and `GET`; `PATCH` transitions;
  merge-to-skill including `source` and `evidence_files`; workspace scoping on
  every verb; the unindexed-repo path making no call at all. The mock validates
  its fixture against the schema, so the contract is enforced by the test setup.
- **client unit / component** — the candidate card (all three statuses), the
  edit control, the merge modal (nothing saved before confirm, no `source` in the
  payload), and the empty state.
- **e2e** — `09-conventions.flow.json`: the screen renders its empty state and
  the seeded list. No step may trigger an LLM call.
- **Not covered by tests:** the quality of the rules themselves. Whether a pass
  finds good conventions is a calibration loop against a real repo and a real
  model, like the skills control experiment.

## Risks

- **The model returns plausible rules with unusable evidence,** and strict
  verification empties the screen. Visible rather than silent — that is what
  `discarded` is for — but it is the most likely first-run outcome, and the fix
  is prompt calibration, not loosening the check.
- **`getConventionSamples` degrades silently.** repo-intel returns `[]` for an
  unindexed repo with no error (`server/CLAUDE.md`, Gotchas). Extraction must
  read that as "index the repo first", not as "no conventions".
- **`messages/en/conventions.json` predates the merged-skill decision.** It has
  `card.acceptAsSkill` on every card, from a design where each candidate became
  its own skill. Using those strings as-is would describe the wrong flow.
- **A slow model turns into a long request.** Extraction blocks the HTTP call it
  arrived on, so the wall-clock of the model call is the wall-clock of the
  request, and "Scanning…" is what the user sees for all of it. The per-request
  ceiling is `EXTRACTION_TIMEOUT_MS` (180 s), but it only binds on the OpenAI
  and Anthropic adapters — `OpenRouterProvider`, which serves the module's
  default model, fixes a 90 s timeout on its SDK client at construction and
  ignores `req.timeoutMs`. So the real ceiling on the default path is 90 s per
  attempt, times the SDK's two retries. A model slower than that fails the scan
  rather than degrading it; raising it means passing `timeoutMs` where the
  container builds the provider. If this becomes routine rather than
  pathological, the answer is a job plus SSE, not a bigger number.
- **A cheap model on a large sample is still a real bill.** The sample size is a
  module constant and the route is rate-limited; the run's cost is reported the
  same way a review's is.
- **The merged skill is generated text in a prompt.** It is stamped `extracted`,
  so `renderSkillBlocks` wraps it with `wrapUntrusted()` exactly like an import —
  strong, not absolute, and readable verbatim in the run trace.

## Open questions

None.
