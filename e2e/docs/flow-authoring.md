# Writing a flow

How to add a browser journey. The runner's behaviour and the rationale are in `../README.md`;
this is the authoring recipe.

## Anatomy

A flow is one JSON file, `specs/NN-kebab-name.flow.json`. Files run in **lexical order** of
their filename, sharing one browser session.

```jsonc
{
  "name": "Short sentence describing what this proves",
  "description": "Why it exists, which components it exercises, and any precondition.",
  "steps": [
    { "cmd": ["open", "{BASE}/"],                    "label": "load the app root" },
    { "cmd": ["wait", "--url", "/pulls"],            "label": "land on the PR list" },
    { "cmd": ["find", "text", "Add rate limiting", "click"], "label": "open the PR row" },
    { "cmd": ["wait", "--load", "networkidle"],      "label": "detail data settles" },
    { "cmd": ["wait", "--text", "2 findings"],       "label": "seeded finding count is shown" }
  ]
}
```

- `cmd` is passed verbatim to the `agent-browser` CLI. `{BASE}` is replaced with
  `E2E_BASE_URL` (trailing slash trimmed).
- `label` is what a failure prints. Write it as the user-visible fact being checked, not as a
  restatement of the command.
- `assert: { stdoutIncludes: "…" }` adds an optional substring check on the command's stdout.
  Use it sparingly — exit codes already carry the signal.

## The assertion model

There is no `expect`. **A non-zero exit fails the step and the flow**, and `wait` exits
non-zero when its condition never holds within the timeout. So:

- `wait --text "2 findings"` *is* the assertion "the text appears".
- `wait --url "/pulls/482"` *is* the assertion "we navigated there".
- `find role button --name "Agent runs" click` *is* both the action and the assertion that the
  button exists.

Per-command timeout is `E2E_STEP_TIMEOUT` (default 60s).

## Allowed locators

Deterministic only:

| Form | Example |
|------|---------|
| URL | `wait --url "tab=findings"` |
| Text | `wait --text "request changes"` |
| Role | `find role button click --name "Agent runs"` |
| Label | `find label "Repository URL" fill "…"` |
| Load state | `wait --load networkidle` |

The AI `chat` command is forbidden. It would make runs non-deterministic, key-dependent, and
billable — the three things this suite exists to avoid.

## Data assumptions

Flows run against the seeded demo data only: repo `acme/payments-api`, PR #482, the built-in
agents. Nothing may trigger a model call — no "Run review" click, no agent execution.

Any flow that starts at `{BASE}/` inherits the home redirect to the **first** repo, which makes
a freshly-seeded, single-repo database a hard precondition. State it in the flow's
`description`, and run through the hermetic stack rather than your dev database.

## Checklist for a new flow

- [ ] Filename numbered so its position in the run order is intentional.
- [ ] `description` names the precondition and the components under test.
- [ ] Every step has a meaningful `label`.
- [ ] Only deterministic locators; no `chat`.
- [ ] No step can trigger an LLM call.
- [ ] `wait --load networkidle` after navigations that fetch, so text checks are not racing.
- [ ] Passes twice in a row via `pnpm e2e:hermetic` — a flow that only passes once is flaky.

## When not to write a flow

If the behaviour can be proven by a component test with mocked hooks, write that instead: it
runs in milliseconds and does not need a stack. Reserve flows for journeys that cross
page boundaries and involve real API + DB. See `../../TESTING.md`.
