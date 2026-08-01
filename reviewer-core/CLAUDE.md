# @devdigest/reviewer-core — the pure review engine. Product quality is decided here.

## Commands

```sh
npm test          # vitest, stubbed LLMProvider — no keys, no network
npm run typecheck # this IS the build; the package never emits JS
```

**npm, not pnpm** — this package has its own `package-lock.json`.

## Map

| File | What |
|------|------|
| `src/prompt.ts` | `assemblePrompt` + `INJECTION_GUARD` + `wrapUntrusted` |
| `src/grounding.ts` | the citation gate |
| `src/llm/structured.ts` | Zod → JSON Schema, `extractJson`, parse-with-repair |
| `src/llm/openrouter.ts` | the one OpenAI-compatible provider shared with CI |
| `src/review/run.ts` | orchestration: single-pass \| map-reduce → reduce → gate |
| `src/review/reduce.ts` | merge partials, slice a file's diff, score from findings |
| `src/output/to-review.ts` | grounded `Review` → GitHub payload (used from L06) |

## Conventions

- **Purity law:** no DB, GitHub, filesystem, or env access. The only side effect is the
  injected `LLMProvider`. Need something from outside? Add a field to `ReviewInput` — never
  an import.
- The score is computed from the findings that **survived** grounding. The model's own score
  is discarded, and so is the pre-grounding set.
- All external text goes through `wrapUntrusted()`. An exception is a security bug.
- Injection defense is the single trusted `INJECTION_GUARD`, not keyword scanning. Do not add
  a denylist: it catches one phrasing in one language and creates false confidence.
- An empty prompt slot (`skills`, `memory`, `specs`, `callers`, `repoMap`, `prDescription`)
  must produce a byte-identical prompt to the one before that slot existed. Section order in
  `assemblePrompt` is part of the contract — changing it changes every agent's behaviour.
- Cancellation is caller-owned: the engine only calls `checkCancelled()`, which throws an
  error type the engine never names.

## Gotchas

- `@devdigest/shared` resolves to `../server/src/vendor/shared` here, so this "independent"
  engine is path-coupled to the server.
- `skills` / `memory` / `specs` are accepted but never passed by the starter server
  (L02 / L07 / L05). They are not dead parameters.
- `costUsd` is computed and returned, but the server deliberately does not persist it (L01).
- `auto` strategy picks map-reduce only when the diff is **both** >400 lines **and**
  multi-file; `map-reduce` on a single-file diff silently falls back to single-pass.

## Read when

- Changing prompt sections, their order, or adding a slot → read `docs/prompt-contract.md`,
  then `../docs/agent-prompts/README.md`
- A finding disappears or the score does not add up → read `src/grounding.ts` in full before
  forming a hypothesis
- Structured output behaves oddly → read `INSIGHTS.md` first
- Starting a task → read `specs/README.md`
