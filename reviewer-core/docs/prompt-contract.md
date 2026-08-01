# Prompt contract

What the model receives, in what order, and the rules that must hold when you change it.
Written for whoever adds a prompt slot in a later lesson. Severity and verdict conventions for
prompt *authors* live in `../../docs/agent-prompts/README.md`.

## The two messages

`assemblePrompt()` produces exactly two messages. Nothing else is sent.

**System** = the agent's `system_prompt`, then a blank line, then `INJECTION_GUARD` verbatim.
The guard is appended on every path — studio and CI — so an agent author never repeats it.

**User** = these sections, in this order, each omitted when its input is empty:

| # | Section | Trusted? | Source |
|---|---------|----------|--------|
| 1 | task line | trusted | `task` — e.g. `Review PR #482 "…"` plus the blast-risk note |
| 2 | `## PR description` | **untrusted** | `prDescription`, truncated to 4000 chars |
| 3 | `## Skills / rules` | trusted-ish | `skills` — resolved bodies, not slugs (L02) |
| 4 | `## Relevant memory` | trusted | `memory` — curated items (L07) |
| 5 | `## Repo skeleton` | **untrusted** | `repoMap` — cached repo map |
| 6 | `## Project context` | **untrusted** | `specs` — one wrapped block per chunk (L05) |
| 7 | `## Callers of changed symbols` | **untrusted** | `callers` — digest built by the server |
| 8 | `## Diff to review` | **untrusted** | `diff` — always last, always present |

The same structure is recorded in `PromptAssembly` for the run trace, so every section can be
inspected per run in the UI.

## Rules for changing it

1. **Order is contract.** Structure before context, context before the diff, the diff last.
   Reordering changes every agent's output; treat it as a behavioural change with a spec.
2. **Empty in, nothing out.** A slot with no value must yield a prompt byte-identical to the
   one before the slot existed. This is what lets a lesson ship a feature that is off by
   default and prove it changed nothing.
3. **Untrusted by default.** Anything derived from the repository, the PR, or a third party is
   untrusted, even when we generated it ourselves — `repoMap` and `callers` are our own output
   over their code, and they are wrapped.
4. **Wrap, do not sanitize.** `wrapUntrusted()` escapes attempts to close the delimiter and
   labels the source. We do not strip, rewrite, or scan the content.
5. **No second defense layer.** Hardening belongs in `INJECTION_GUARD`, in one place, in
   natural language. Pattern-matching untrusted text for "ignore previous instructions" or
   "test fixture" is explicitly rejected: it catches one phrasing in one language, and gives
   false confidence for every other.
6. **Budget the input.** A new slot must have a cap (character truncation like
   `prDescription`, row limits like `callers`, or a token budget like `repoMap`). No slot may
   grow unbounded with repository or PR size.

## Adding a slot — checklist

- [ ] Field added to `PromptParts` and to `ReviewInput`, both documented as trusted/untrusted.
- [ ] Rendered in the right position in `assemblePrompt`, wrapped if untrusted.
- [ ] Recorded in the returned `PromptAssembly` so it shows up in the run trace.
- [ ] `PromptAssembly` mirrored in **both** `vendor/shared` copies.
- [ ] Cap or budget defined.
- [ ] Test proving the omitted-slot prompt is unchanged.
- [ ] Caller resolves the value to a string (DB in the studio, filesystem in the CI runner) —
      the engine never resolves anything itself.

## After the model answers

The response is parsed against the `Review` Zod schema (JSON Schema, with `parseWithRepair`
and a retry budget), partials from map-reduce are merged by `reduceReviews`, then
`groundFindings` drops every finding that does not cite a real line of the diff, and the score
is recomputed from the survivors. Dropped findings are reported as events, never swallowed.

The gate is applied once, after the reduce — not per chunk. Keep it that way: a per-chunk gate
would drop cross-file findings that the reduce step is supposed to keep.
