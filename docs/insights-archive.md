# Insights archive

Entries that were promoted into a `CLAUDE.md` rule and then moved out of an active
`INSIGHTS.md` to keep it under ~250 lines. Nothing here is stale — the rule each one produced
is live; this file is only where the reasoning behind it is kept.

Moved from the root `INSIGHTS.md` on 2026-08-02. Format and sections are the same as any
`INSIGHTS.md`; see [`../.claude/skills/engineering-insights/SKILL.md`](../.claude/skills/engineering-insights/SKILL.md).

---

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

Only the **root** file has needed spilling so far. The per-package files are well under the
limit; their promoted entries stay where they are.
