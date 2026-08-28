# Architecture — how a review actually runs

The end-to-end path from "user clicks Review" to "grounded findings on screen", and the
invariants that path depends on. Read this before changing anything in the review flow.

## Packages and how they reach each other

```mermaid
flowchart TB
  subgraph host["Local machine"]
    WEB["client/ @devdigest/web<br/>Next.js 15 · :3000"]
    API["server/ @devdigest/api<br/>Fastify 5 · :3001"]
    PG[("Postgres + pgvector<br/>Docker :5432")]
  end

  ENG["reviewer-core/<br/>pure engine, zero I/O"]

  WEB -->|"REST + SSE"| API
  API --> PG
  API -->|"tsconfig alias → TS source"| ENG
  ENG -->|"injected LLMProvider"| LLM["OpenAI / Anthropic / OpenRouter"]
  API --> GH["GitHub API (PR data)"]
  API --> GIT["git clone → ~/.devdigest/workspace"]

  SH["@devdigest/shared (Zod contracts)"]
  SH -.->|"mirror copy"| WEB
  SH -.-> API
  SH -.-> ENG
```

There is no build step between packages: the server imports `@devdigest/reviewer-core`
as TypeScript source (tsx in dev, vitest in tests). `reviewer-core` never emits JS — its
`build` script is a type-check.

## The review sequence

```mermaid
sequenceDiagram
  actor U as User
  participant W as client
  participant R as reviews/routes.ts
  participant S as ReviewService
  participant X as ReviewRunExecutor
  participant N as intent module
  participant I as repoIntel facade
  participant E as reviewer-core
  participant L as LLM
  participant D as Postgres

  U->>W: Review
  W->>R: POST /pulls/:id/review {agentId | all:true}
  R->>S: runReview()
  S->>D: INSERT agent_runs (status=running) → runId
  S-->>W: 200 {runs:[runId]}, reviews:[]  (immediately)
  S--)X: executeRuns() — fire-and-forget

  W->>R: GET /runs/:id/events (SSE, replay buffer first)

  X->>X: loadDiff (GitHub or local git)
  X->>N: forReview(pull, changed paths) — once per batch
  N->>D: SELECT pr_intent
  alt head_sha unchanged
    N-->>X: cached intent, zero model calls
  else never derived, or head moved
    N->>L: one cheap structured call (review_intent model)
    N->>D: UPSERT pr_intent
    N-->>X: derived intent + confidence note
  end
  X->>I: getRepoMap / getFileRank / getCallerSignatures
  I-->>X: repo map + "top 5% blast risk" note + caller signatures
  X->>E: reviewPullRequest({systemPrompt, diff, repoMap, callers, prDescription, intent, llm})
  E->>E: assemblePrompt + INJECTION_GUARD + wrapUntrusted
  E->>L: completeStructured(schema = Review)
  L-->>E: JSON findings
  E->>E: groundFindings() — citation gate
  E->>E: score = f(surviving findings)
  E-->>X: ReviewOutcome
  X->>D: reviews + findings + agent_runs(done) + run_traces
  X--)W: SSE events → complete
  W->>R: refetch GET /pulls/:id/reviews
```

Two of those steps are **pre-work**: the diff and the intent are resolved once for the whole
batch, before the first agent starts, and every agent in the batch is handed the same pair.
The intent step is a cache keyed on `pr_intent.head_sha` — an unchanged head costs nothing — and
it is allowed to fail: the run continues without the section, with the reason in the Live Log.

## The five invariants

**1 — Grounding is mandatory.** `reviewer-core/src/grounding.ts` drops any finding whose
`[start_line, end_line]` does not intersect a real hunk of the diff for the same file. The
score is then recomputed from the survivors; the model's self-reported score is discarded.
Findings of kind `secret_leak`, `lethal_trifecta`, `phantom`, `hook` come from full-file
scanners and only need the file to be present in the diff.

**2 — Prompt-injection defense is one trusted rule, not text scanning.** `INJECTION_GUARD`
(`reviewer-core/src/prompt.ts`) is appended to every agent's system prompt on every path.
All external content is wrapped in `<untrusted source="…">` blocks. We deliberately do not
keyword-scan untrusted text: a denylist only ever catches one phrasing in one language.

**3 — Secrets have exactly one read chokepoint.** `platform/config.ts` has no key fields by
design. `adapters/secrets/local.ts` reads `~/.devdigest/secrets.json` (mode 0600) with
`process.env` as fallback. After a key changes, call `container.invalidateSecretCaches()`.

**4 — Repo intel degrades silently.** Indexing runs as a background job after clone; a
review only *reads* the index. If the repo is unindexed, or `REPO_INTEL_ENABLED=false`, or
the agent's `repo_intel` toggle is off, the facade returns empty and the prompt sections
simply disappear. "Missing context" is not an error state.

**5 — Blockers are deterministic.** The timeline colour comes from
`countBlockers(findings, agent.ciFailOn)` — computed from finding severities, not from the
model's `verdict` field.

## Blast radius — a read that must not parse the repository

`GET /pulls/:id/blast` answers "what else can this diff reach" **entirely from the
pre-built index**: no AST parse, no import-graph build, no clone read and no model call.
That is a property of the code path rather than a budget note, and it is why
`modules/blast` calls `repoIntel.getBlastRadiusFromIndex` rather than `getBlastRadius` —
the latter falls back to a ripgrep pass over the clone when the index cannot answer, which
is exactly the request-time parse this feature must not do. A `null` from the index-only
method is rendered as a degraded state with a reason.

Endpoint attribution is per SYMBOL, and each symbol's traversal is seeded from its own
callers. A single traversal from the changed file would hand every symbol declared in that
file the same list of routes.

```mermaid
sequenceDiagram
    autonumber
    participant C as client (Blast tab)
    participant R as blast/routes.ts
    participant S as blast/service.ts
    participant I as repoIntel facade
    participant PG as Postgres

    C->>R: GET /pulls/:id/blast
    R->>S: forPull(workspaceId, prId)
    S->>PG: reviewRepo.getPull — the one workspace-scoped PR query
    S->>PG: pr_files → changed paths
    S->>I: getIndexState(repoId)
    I-->>S: status + last_indexed_sha
    S->>I: getBlastRadiusFromIndex(repoId, paths)
    I->>PG: symbols · references.decl_file · file_rank · file_facts
    I-->>S: BlastResult, or null when the index cannot answer
    loop per distinct caller-file set (memoised)
        S->>I: getDependents(repoId, callerFiles, 1)
        I->>PG: file_edges keyed on (repo_id, to_file)
        I-->>S: level-2 files + their file_facts
    end
    S-->>R: BlastRadiusResponse + status/reason/indexed_sha
    R-->>C: 200, log line carrying llmCalls: 0
```

**The two levels.** A symbol's resolved callers are, by construction, direct importers of
the changed file — level 1. One further reverse hop over `file_edges` reaches level 2, which
is the total depth of two the feature promises. Endpoints and crons are read from
**production files only**: a test file can register routes that exist nowhere else, though
its *calls* are kept, because those are real calls of real code.

**Six answers, never a bare empty array.** `status` (`ok | partial | degraded`) says how far
the map is to be trusted and `reason` says why it looks the way it does. Three reasons are
degraded — the index cannot speak; one is partial; and three are `ok` with nothing to draw
(`no_changed_files`, `no_indexed_symbols`, `no_callers`). Index health is decided first,
because it is the precondition for every other statement the response makes.

**One optional model call.** `POST /pulls/:id/blast/explain` turns the already-computed map
into one paragraph, behind an explicit button. Nodes and edges are passed in and the model
is forbidden from naming anything else; nothing is persisted. The two routes log
`llmCalls: 0` and `llmCalls: 1` as literals, which is what makes the claim checkable.

## Two background mechanisms, not one

- **`JobRunner`** (`server/src/platform/jobs.ts`) — clone, index, poll. A p-queue with
  concurrency 3, mirrored into the `jobs` table, with a 120s timeout and retry.
- **`RunBus`** (`server/src/platform/sse.ts`) — an **in-memory** event bus plus replay
  buffer feeding `GET /runs/:id/events`. Reviews do **not** go through JobRunner:
  `runReview` fires `void executor.executeRuns(...)` and returns the runId at once.

Because RunBus is in-memory, a server restart loses the live log — which is exactly why the
full log is persisted as one `run_traces` document, including on failure and cancellation.
On boot, `reapStaleRuns()` marks every `running` row as dead before the server accepts
requests; this assumes a **single API instance per database**.

## Tenancy

Every domain table carries `workspace_id`. Every route starts with
`getContext(container, req)` (`server/src/modules/_shared/context.ts`), which in MVP resolves
through `LocalNoAuthProvider` to the single seeded workspace and system user. Real auth is a
one-adapter swap; call sites already depend on the interface.

## Related reading

- API surface and DI flow → `server/README.md`
- UI route map → `client/README.md`
- Engine pipeline → `reviewer-core/README.md`
- Indexer internals → `server/src/modules/repo-intel/README.md`
- Prompt assembly and severity conventions → `docs/agent-prompts/README.md`
- Test strategy → `TESTING.md`
