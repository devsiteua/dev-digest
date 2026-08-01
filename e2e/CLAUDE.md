# @devdigest/e2e — deterministic browser flows. No LLM, no API key.

## Commands

```sh
pnpm e2e:hermetic   # ← use this. Isolated stack on 5433/3101/3100, freshly seeded
npm test            # only against an already-running stack with a fresh DB
npm i -g agent-browser && agent-browser install   # one-time CLI install
```

## Map

| Path | What |
|------|------|
| `specs/NN-name.flow.json` | a flow = an ordered list of agent-browser commands |
| `run.ts` | the runner — one shared browser session across steps |
| `lib/assert.ts` | stdout assertions |
| `agent-browser.json` | CLI config |

**Note:** `specs/` here means *browser flows*, not lesson specs. Lesson specs for this package
live in the root `../specs/`.

## Conventions

- This is **not** Playwright. The driver is agent-browser (Rust + CDP), a CLI, not a test
  framework — a flow is data, not code.
- Locators are deterministic only: `--url`, `--text`, `find role|text|label`. The AI `chat`
  command is **forbidden** — it makes runs unstable and costs money.
- `wait --text` / `wait --url` **are** the assertions: they exit non-zero on timeout, which
  fails the step and the flow. Do not add a separate assertion layer for them.
- Flows only touch read-only seeded data (`acme/payments-api`, PR #482, the seeded agents) so
  no step can trigger a model call.
- `{BASE}` is substituted with `E2E_BASE_URL`; never hardcode a host or port in a flow.
- Every step gets a `label` — it is what a failure report shows.

## Gotchas

- Flows 02 / 04 / 05 follow the home redirect to the **first** repo, so they require a
  freshly-seeded database. Against your dev DB they land on the wrong repo and fail. Use the
  hermetic runner.
- **Never** reset the dev database with `docker compose down -v` — that deletes the
  `devdigest_pgdata` volume along with every imported repo and review.
- The hermetic runner uses alternate ports on purpose; a flow that assumes `:3000` will pass
  locally and fail in CI, or worse, drive your real dev instance.

## Read when

- Adding or fixing a flow → read `docs/flow-authoring.md`, then `README.md`
- Unsure whether something belongs here or in a component test → read `../TESTING.md`
- A flow is flaky → read `INSIGHTS.md` first
- Starting a task → read `../specs/README.md` (this package has no local specs folder)
