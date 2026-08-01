# Reviewer-core specs

Specs for work confined to the engine. Anything that also changes how the server assembles
inputs — which most prompt work does — belongs in the root
[`../../specs/`](../../specs/README.md).

Format, status values, and the promotion rules are defined once in the root specs README.
Copy [`../../specs/TEMPLATE.md`](../../specs/TEMPLATE.md).

Engine-specific sections worth filling in every time:

- **Purity** — does this need anything the engine cannot do (DB, fs, network)? If yes, the
  work belongs in the server and only the resolved value crosses the boundary.
- **Prompt impact** — new section, changed order, or none? See
  [`../docs/prompt-contract.md`](../docs/prompt-contract.md).
- **No-op proof** — which test shows the prompt is unchanged when the new input is absent.
- **Grounding impact** — does this introduce a finding `kind` that must be treated as
  full-file rather than line-anchored?

No open engine-only specs.
