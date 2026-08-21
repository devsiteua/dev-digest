# L02 — Skills in the product

Status: done
Owner: —
Packages touched: server, client, reviewer-core (tests only), e2e

## Goal

A user can write, edit and import reusable markdown instruction blocks, attach an
ordered set of them to any agent, and see exactly which ones reached a review's
prompt and what they cost. One rule, written once, can now be used by several
agents instead of being copy-pasted into each agent's system prompt.

## Context

Most of this feature was already scaffolded in the starter and simply never wired
up — the "grep before building" entry in the root `INSIGHTS.md` predicted exactly
this. Already present before a line was written: the `skills`, `skill_versions`
and `agent_skills` tables (with an `order` column) in `0000_init.sql`; the `Skill`
/ `SkillType` / `SkillSource` / `AgentSkillLink` contracts in both `vendor/shared`
copies; `GET/POST /agents/:id/skills` with `AgentsRepository.linkedSkills()`; the
`skills` slot in `assemblePrompt` and its `PromptAssembly.skills` trace key; the
conditional Skills block in the run-trace drawer; and a complete
`client/messages/en/skills.json`.

The work was therefore to close the circuit, not to design one.
See `docs/agent-prompts/README.md` § "Skills / rules" for the prompt contract and
`docs/skills-control-experiment.md` for the with/without demonstration.

## In scope

- `server/src/modules/skills/` — CRUD, body versioning, and a two-step import
  (`POST /skills/import/preview` parses and writes nothing; `POST /skills/import`
  persists). Registered in `modules/index.ts`.
- Markdown + zip parsing in `modules/skills/helpers.ts` (frontmatter, `SKILL.md`
  discovery, ignored-entry enumeration) using `fflate`, in memory only.
- `renderSkillBlocks` + `buildSkillBlocks` — resolve an agent's linked, enabled
  skills into `reviewPullRequest({ skills })`, wrapping non-`manual` bodies in
  `wrapUntrusted`.
- Workspace validation of `skill_ids` in `AgentsService.setSkills` / `linkSkill`.
- `SkillSource` gains `imported_file`; `SkillVersion` and `SkillDraft` added to
  `contracts/knowledge.ts` (both copies), and the pre-existing drift in that file
  repaired.
- Client: `/skills` and `/skills/:id` (list + Config/Preview editor),
  `AddSkillDrawer`, a `Skills` tab in the agent editor, `hooks/skills.ts`, a
  `Skills` entry in `NAV`, and a per-block token badge in the run trace.
- Seed: four skills, the `Test Quality Reviewer` and `API Contract Reviewer`
  agents (disabled), their links, demo PRs #483/#484, and an import fixture.
- Prompts: `docs/agent-prompts/{test-quality,api-contract}-reviewer.md`, mirrored
  into `seed-prompts.ts` and pinned by `test/agent-prompts-mirror.test.ts`.

## Out of scope

- **Import from URL** and the **community catalogue** (`skills.json` still carries
  their strings). A server-side outbound fetch is an SSRF surface and a new
  adapter; neither is needed to demonstrate skills.
- **A Versions tab.** Body snapshots are written to `skill_versions` from day one,
  but diff/restore UI is not built.
- **Evals / Stats tabs** on a skill — those are L06's tables.
- **The Conventions extractor**, the other half of the L02 line in the index.
- **A `skillCount` badge on the agent card.** The count is only reachable per
  agent, so a list of N agents would cost N extra requests, or a contract change.
- **Versioning an agent when its links change.** `setSkills` does not snapshot,
  even though `AgentVersionConfig.skills` exists.
- **Drag-and-drop reordering** — no dnd library exists in the client, and ↑/↓
  posts the identical payload.
- Syncing the four other drifted `vendor/shared` files.

## Decisions

- **`reviewer-core/src` is untouched.** The slot, its position and its trace key
  already existed; the server fills it from the call site. That is why "an agent
  with no skills produces the prompt it produced yesterday" is mechanical rather
  than careful — pinned in `reviewer-core/test/prompt.test.ts`.
- **The server decides provenance, not the caller.** `source` is never read from a
  request body: `POST /skills` stamps `manual`, `POST /skills/import` stamps
  `imported_file` + `enabled: false`, and `PUT` refuses the field entirely.
  Otherwise a client could label imported text `manual` and skip the untrusted
  wrapping that the whole trust model rests on.
- **Untrusted wrapping happens in the server.** `prompt.ts` documents the slot as
  "community skills should be sanitized upstream"; `renderSkillBlocks` is that
  upstream. Doing it in the engine would mean changing `PromptParts` from
  `string[]` to a tagged shape and dragging the CI runner along.
- **Skill bodies get no added heading.** `assemblePrompt` already emits
  `## Skills / rules`, and bodies carry their own `#` titles.
- **Two independent switches.** `skills.enabled` is the global master switch; a row
  in `agent_skills` is the per-agent attachment; `order` is prompt order. A skill
  reaches a prompt only if both hold. No migration, and `setSkills` already
  models attach/detach/reorder as one call.
- **No change to `contracts/trace.ts`.** `run_traces` stores historical documents,
  and the `RunStats.cost_usd` entry in `INSIGHTS.md` records what a wrongly-typed
  new field does to them. Per-block tokens are estimated on the client from text
  that is already stored (so old traces get the badge too); the exact count from
  the real tokenizer goes to the run log.
- **Imports arrive as JSON, not multipart.** The browser must read the file anyway
  to show a preview, and `lib/api.ts` speaks only JSON. Archives are base64; the
  client rejects >512 KB before sending so the user sees a sentence, not a 413.
- **`SkillSource` gained `imported_file`.** `type`/`source` are plain `text`
  columns with no CHECK constraint (verified in `0000_init.sql`), so this is a
  type-level change with no migration. Known consequence: `PluginSkill.source` in
  `contracts/productionize.ts` keeps its own narrower inline copy until L08 —
  that file is already drifted between the two `vendor/shared` trees and editing
  it here would have widened the diff into someone else's scope.
- **Name uniqueness is enforced in the service, not the DB.** A unique index means
  a migration. The check is therefore advisory under concurrent writes, which is
  acceptable for a single-user local studio.
- **Both new agents are seeded disabled.** `ReviewService.resolveAgents` sends
  `all: true` to `listEnabled`, so seeding them enabled would have taken every
  existing "run all agents" review from three LLM calls to five. A named agent
  runs regardless of the flag, which is how the demo drives them.
- **The system prompt holds the role; the skill holds the checklist.** Without
  that split the control experiment shows nothing, because an agent whose prompt
  already lists the concrete checks finds the defect with its skills detached.

## Acceptance criteria

- [x] A skill can be created and edited in the UI; saving a changed body bumps
      `version` and appends to `skill_versions`, while a metadata-only edit does not.
- [x] `/skills` is a two-pane screen: list on the left, Config/Preview on the right.
- [x] `Test Quality Reviewer` and `API Contract Reviewer` are seeded with linked
      skills, and `no-then-chains` is linked to both.
- [x] The agent editor's Skills tab attaches, detaches and reorders; the order it
      shows is the order of the blocks in the prompt.
- [x] A linked + enabled skill appears in `prompt_assembly.skills`; disabling one
      removes just that block; detaching all of them removes the section entirely.
- [x] The run log records `skills: N skill(s), M token(s) attached (…)`.
- [x] Import runs through a preview; nothing is written until confirmation; every
      non-markdown archive entry is listed as ignored and never read or executed.
- [x] An imported skill is stored disabled, badged, and delimiter-wrapped in the
      prompt; `PUT` cannot relabel its `source`.
- [x] Prompt blocks in the run trace carry a token estimate, including on traces
      recorded before this change.
- [x] **Regression:** an agent with no skills produces a byte-identical prompt.
- [x] **Regression:** "run all enabled agents" still resolves to three agents.
- [x] **Regression:** `git status server/src/db/migrations` is clean.
- [x] **Regression:** both `vendor/shared/contracts/knowledge.ts` copies are identical.
- [x] **Regression:** `pnpm arch:check` is green and the known-violations baseline
      is unchanged.
- [x] **Regression:** the pre-existing `AgentEditor` and `RunTraceDrawer` component
      tests still pass.

## Test plan

- **reviewer-core unit** — `test/prompt.test.ts`: byte-identical prompt for
  absent / `undefined` / `[]` skills; section content, separator and position
  between `## PR description` and `## Relevant memory`; an already-wrapped body
  passes through untouched.
- **server unit** — `test/skills-helpers.test.ts` (frontmatter, name/description
  derivation, `SKILL.md` discovery at root and one level down, case-insensitive
  match, ignored entries, archive limits, the real demo bundle);
  `test/reviews-helpers.test.ts` (`renderSkillBlocks`: verbatim vs wrapped,
  delimiter-escape, order, whole-skill budget drops); `test/agent-prompts-mirror.test.ts`
  (each `docs/agent-prompts/*.md` equals its seeded constant).
- **server `*.it.test.ts`** — `test/skills.it.test.ts`: CRUD and versioning,
  duplicate names, cascade on delete, workspace scoping on every verb, a foreign
  `skill_id` rejected at the link endpoint, preview writing nothing, `source`
  immutable, set/reorder/clear, the seed's shape, and a `MockLLMProvider` run
  asserting the skills block appears, shrinks and disappears.
- **client unit / component** — `SkillCard`, `SkillEditor` (both tabs),
  `SkillsTab` + its `helpers`, `AddSkillDrawer` (nothing saved before confirm; no
  `source`/`enabled` in the payload; oversized archive rejected client-side),
  `AgentEditor` tab switching, and the trace `helpers`.
- **e2e** — `08-skills.flow.json`: `/skills` renders seeded cards, opens one, and
  switches to Preview. No step can trigger an LLM call.
- **Not covered by tests:** the control experiment itself — real model calls,
  non-deterministic and billable. It is a written procedure
  (`docs/skills-control-experiment.md`).

## Risks

- **map-reduce multiplies the section.** `assemblePrompt` runs per file in that
  strategy, so the skills block is paid for per file. Both new agents use
  `single-pass`, and `MAX_SKILLS_CHARS` caps the section; dropped skills are named
  in the run log rather than vanishing.
- **An imported skill is still somebody else's instructions.** `wrapUntrusted` +
  `INJECTION_GUARD` are strong, not absolute. Mitigated by importing disabled, the
  vetting badge, and the fact that the exact text is readable in the trace.
- **The control experiment may not show a difference on the first try** — that is
  a calibration loop on the demo diff, not a defect. Documented as such.
- **Advisory name uniqueness** can be defeated by two concurrent creates.

## Open questions

None.

---

# Round 2 — the four gaps the mentor named

Status: done · 2026-08-12

## Context

The lesson was submitted and accepted. The review named four things missing
against the design, three of which are verbatim entries in Round 1's
§ Out of scope — deliberate cuts, not oversights. Round 2 pays them off anyway,
because they are what the Skills screen is missing to be finished, and it fixes
the one item that was never a decision at all:

| Reviewed | Round 1 status |
|---|---|
| Skill editor has two tabs; no `/skills/:id/stats`, no `/skills/:id/restore` | out of scope — *"A Versions tab"*, *"Evals / Stats tabs"* |
| `skill_count` is supported by the card but computed nowhere | out of scope — *"a list of N agents would cost N extra requests, or a contract change"* |
| Reordering uses ↑/↓ buttons, not HTML5 drag-and-drop | out of scope — *"no dnd library exists in the client, and ↑/↓ posts the identical payload"*; paid off here, without a library |
| The sidebar has one WORKSPACE section, no SKILLS LAB | **not a decision** — Round 1 added a `Skills` entry to `NAV` and never revisited the grouping |

## In scope

- `NAV` splits into WORKSPACE (Pull Requests) and SKILLS LAB (Skills, Agents,
  Conventions), in the design's order. `Sidebar.tsx` already rendered a heading
  per group, so this is `vendor/ui/nav.ts` only — touched under the explicit
  request that this round is.
- `POST /skills/:id/restore` + a **Versions** tab: every snapshot, the current
  one badged, a past body on request, and a restore that appends.
- `GET /skills/:id/stats` + a **Stats** tab: attached agents, runs, findings,
  accept rate and a category breakdown over the last `STATS_WINDOW_DAYS` (30).
- `Agent.skill_count` (both `vendor/shared` copies), computed by one grouped
  query in `AgentsRepository.skillCounts`, plus `skillCountFor` for the single
  reads. `AgentCard` renders it; the mutations that move it invalidate `agents`.
- **Drag-to-reorder** on the agent's Skills tab, on the platform's own HTML5
  drag events: a grip per row as in the design, the dragged row dimmed, an
  insertion rule on the row the drop lands on. The ↑/↓ buttons are **removed** —
  the design has no arrows, and two controls for one action is the kind of
  leftover that reads as an unfinished port.

## Out of scope

- **A drag-and-drop library.** The reordering below is the platform's own HTML5
  drag events; nothing is installed.
- **The design's Evals tab.** `eval_cases` is empty until L06; a tab whose only
  reachable state is an empty state teaches nothing.
- **`PULL FREQUENCY` on the Stats tab.** See Decisions — it is not derivable.
- **A `GLOBAL` nav section** (Memory, Multi-Agent Review, Agent Performance, CI
  Runs) and the `Eval Dashboard` item: all are routes that do not exist yet.
- **Diffing two versions.** The Versions tab shows a snapshot, not a diff; no
  diff renderer exists outside the PR viewer and the tab reads fine without one.

## Decisions

- **The Stats tab measures AGENTS, and says so on screen.** `findings` has no
  `skill_id` — it hangs off `reviews.agent_id` — so every number below `used_by`
  is attribution to the agents carrying the skill, and two skills on one agent
  report identical totals. The tab prints that sentence above the tiles, and
  `SkillStats`' docstring repeats it. The design's `PULL FREQUENCY` tile is
  therefore absent rather than estimated: nothing persisted says which skills a
  given run's prompt actually carried (the run log names them in prose; matching
  on that string is not a measurement). `RUNS (30d)` takes its place.
- **`accept_rate` is `null`, never `0`, while nothing is triaged.** "No one has
  looked yet" and "everything was dismissed" are opposite facts, and a 0% ring
  would render them the same.
- **Restore moves forward.** `POST /skills/:id/restore` writes the old body
  through the normal update path, so v2 restored onto a v5 skill lands as v6 and
  v3–v5 stay in `skill_versions`. Nothing is overwritten, so an eval that scored
  v4 can still be replayed — the reason the table exists. Restoring the current
  body is a no-op, because `update` only bumps when the text changed.
- **`skill_count` is `.nullish()`, and absent means "nobody counted".** A card
  with no count shows no badge rather than "0 skills": a producer that has no
  cheap way to count (a plugin export, a fixture) must not be able to publish a
  zero it did not measure. `AgentsService.create` passes a measured 0.
- **The count is computed, not stored.** One `group by` over `agent_skills` for
  the list, one `count` for a single read. A denormalised column would need a
  migration and would have to be maintained by every writer of the link table.
- **A drop is resolved by ID, never by index.** The list can be filtered, so the
  row a drop lands on says nothing about its position in the saved order;
  `reorder(ids, dragId, targetId)` makes a drop mean the same thing with a
  filter applied as without one. Only an attached row is draggable, and a drop
  onto an unattached one is a no-op rather than an invented position.
- **The stats queries live in `SkillsRepository`.** They read `agents`,
  `agent_runs`, `reviews` and `findings` — tables other modules own the write
  side of — which is a cross-domain READ, not the cross-module import the onion
  guard polices. No module code is imported; asking two sibling services would
  put service-to-service calls in a path that is two SQL statements.

## Acceptance criteria

- [x] The sidebar shows WORKSPACE and SKILLS LAB, and every `g`-shortcut still
      resolves (both NAV consumers flatten the groups).
- [x] The skill editor has four tabs; an unknown `?tab=` still lands on Config.
- [x] Restoring v1 of a v2 skill produces v3 with v1's body and leaves `[3,2,1]`
      in the version list; restoring the current version adds nothing.
- [x] `POST /skills/:id/restore` 404s an unrecorded version and 422s version 0.
- [x] `GET /skills/:id/stats` returns zeros and `accept_rate: null` for a skill
      no agent uses, and 404s across workspaces.
- [x] Findings of an agent carrying the skill are counted and split by triage
      state and category.
- [x] `GET /agents` and `GET /agents/:id` carry `skill_count`; it follows a
      link change and a cascading skill delete.
- [x] An agent card with no `skill_count` renders no badge, and one with `0`
      renders "0 skills".
- [x] Dragging a row onto another renumbers the list immediately and posts that
      order on save; a drop onto itself or onto an unattached row changes
      nothing; an unattached row is not draggable.
- [x] **Regression:** `git status server/src/db/migrations` is clean — no schema
      change was needed.
- [x] **Regression:** both `vendor/shared/contracts/knowledge.ts` copies are
      byte-identical.
- [x] **Regression:** `pnpm arch:check` green, known-violations baseline unchanged.

## Test plan

- **server `*.it.test.ts`** — `test/skills.it.test.ts`: restore forward /
  no-op / 404 / 422, stats for an unused and a used skill, findings attribution
  and triage split, cross-workspace 404, and `skill_count` through link changes
  and a cascading delete (including that each agent gets its own count, not its
  index in the list).
- **server unit** — `test/contracts.test.ts`: `Agent.skill_count` absent / null /
  integer / non-integer, and `SkillStats.accept_rate` nullable but required.
- **client component** — `SkillEditor.test.tsx` gains Stats and Versions blocks:
  the attribution sentence, the tiles, the disabled-agent marker, the dash for an
  untriaged rate, the empty state replacing the whole tab, the current-version
  badge, body-on-request, and that Restore posts the clicked row's version.
  `AgentCard.test.tsx` covers count-from-agent, `0`, and no-badge.

## Risks

- **The Stats numbers can still be misread** as the skill's own performance. The
  on-screen sentence is the whole mitigation; if it is ever edited away, the tab
  starts lying. L06's eval pipeline is what replaces the approximation.
- **`runs` counts every run of an attached agent**, including runs from before
  the skill was attached — `agent_skills` records no timestamp. Inside a 30-day
  window on a local studio this is small; a longer window would need one.
- **Reordering is now pointer-only.** HTML5 drag-and-drop has no keyboard
  equivalent, and the ↑/↓ buttons that provided one are gone. Attaching,
  detaching and everything else on the tab stay reachable from the keyboard;
  only ORDER does not. A keyboard path would be a roving-focus handler on the
  rows (arrow keys with a modifier to move), which is a real piece of work and
  was not part of closing this gap.

## Open questions

None.
