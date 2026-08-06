---
name: no-console-in-prod
description: Apply to application code outside tests — flag console.* calls that would write to a production process's stdout instead of the structured logger.
---

# No console.* in production code

Application code logs through the injected structured logger, never through
`console`. A `console.log` in a request path writes unstructured text to stdout,
where it is neither correlated with a run nor redacted.

## Rule

Flag any `console.log` / `console.error` / `console.warn` / `console.debug` added
to application code. Cite the exact line.

## Not a finding

- Test files, fixtures, and anything under a `test/` or `__tests__/` directory.
- CLI entry points and scripts, where stdout *is* the interface.
- A migration or seed script run by hand.

## What to suggest instead

The module already receives a logger — use it, and attach the identifiers that
make the line searchable:

```ts
logger.info({ runId, agent: agent.name }, 'review complete');
```
