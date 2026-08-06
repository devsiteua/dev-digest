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
