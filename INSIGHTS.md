# Insights — cross-package

Append-only. **Newest first.** One entry per thing that surprised us, cost us time, or turned
out not to be what it looked like. Package-specific findings go in that package's
`INSIGHTS.md`; this file is only for what spans packages or the repo as a whole.

## Entry format

```markdown
## YYYY-MM-DD · One-line title
Trigger:  what we were doing / what we saw
Cause:    what was actually going on
Takeaway: what to do differently next time
Status:   open | resolved | → promoted to <file>
```

**Promotion rule:** an entry that saves us twice becomes a one-line rule in the relevant
`CLAUDE.md` and is marked `→ promoted` here. Keep this file under ~150 lines; once promoted
entries pile up, move them to `docs/insights-archive.md`.

---

## 2026-08-01 · Docs drift found during the first full repo walkthrough

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
Status:   open — fix opportunistically when touching those files

## 2026-08-01 · The two `vendor/shared` trees have already diverged

Trigger:  comparing `server/src/vendor/shared` with `client/src/vendor/shared`
Cause:    there is no workspace and no build step keeping them in sync — they are two
          physical copies. Five files differ today. The server copy is ahead: it has
          `sessionId` on LLM options, `openrouter` in the `LLMProvider.id` union,
          `CommitFiles`, `AgentManifest`, and `AgentVersionConfig`.
Takeaway: harmless right now (the drift is confined to server-only ports the client never
          imports), but a contract edit **must** be applied to both copies. Diff them before
          committing anything under `vendor/shared`.
Status:   → promoted to `CLAUDE.md` (Gotchas)

## 2026-08-01 · An empty table in the schema is a future lesson, not dead code

Trigger:  `db/schema/` defines ~35 tables while the starter reads maybe a third of them
Cause:    the schema is intentionally complete from day 1 so lessons L01–L08 only ever add
          columns, never restructure. Same idea in `reviewer-core`: the `skills`, `memory`,
          and `specs` prompt slots exist and are simply never filled by the starter.
Takeaway: never "clean up" an unused table, contract, or prompt slot. Check the lesson table
          in `README.md` first.
Status:   → promoted to `CLAUDE.md` (Gotchas)
