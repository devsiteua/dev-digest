---
name: engineering-insights
description: "Reads and appends engineering insights to the INSIGHTS.md of the package a task touches. Use at the start of a task to load what earlier sessions learned about that package, and before wrapping up a session to record anything non-obvious that surfaced — a surprising cause, a dead end, a convention the code does not announce, a dependency quirk. Trigger terms: insights, INSIGHTS.md, learnings, wrap up, retrospective, what did we learn, lessons learned."
allowed-tools: Read, Edit, Grep, Glob
---

# Engineering Insights

Append-only journal of what this repo taught us the hard way. Read it before you work,
write to it before you stop.

## 1. Route to one file

| Task touched | File |
|---|---|
| `server/**` only | `server/INSIGHTS.md` |
| `client/**` only | `client/INSIGHTS.md` |
| `reviewer-core/**` only | `reviewer-core/INSIGHTS.md` |
| `mcp/**` only | `mcp/INSIGHTS.md` |
| `e2e/**` only | `e2e/INSIGHTS.md` |
| two or more packages, or `scripts/` `docs/` `specs/` `.github/` `docker-compose.yml` | `INSIGHTS.md` (root) |

A contract edit under `vendor/shared` touches server **and** client → root.

## 2. Read first — always, both directions

**At the start of a task:** read the routed file and the root file before touching code.
Treat entries as high-confidence guidance unless the code contradicts them.

**Before writing:** read them again. If the finding is already there, **stop — write
nothing**. Do not restate it, do not add a near-duplicate under a different heading. If an
existing entry has become wrong, append a dated correction; never rewrite history.

## 3. Write only what clears the bar

Keep the entry only if it is all four:

- **non-obvious** — not clear to someone who just read the code
- **specific** — names a file, symbol, number, or command
- **actionable cold** — the next reader knows what to do without asking anyone
- **durable** — still true next month

✗ "Promises can be tricky" · "be careful with async" — noise, not a lesson
✓ "`Promise.all()` on the ingest pipeline times out past 30 items — use `Promise.allSettled()`
in batches of 10"

If nothing clears the bar, write nothing and say so. A session with no entry is a normal
outcome, not a failure.

## 4. Append

Under the matching `##` section, newest first. Never overwrite, reorder, or delete.

```
### YYYY-MM-DD · One-line title
Trigger:  what we were doing / what we saw
Cause:    what was actually going on
Takeaway: what to do differently next time
Evidence: path/to/file.ts:LINE
Status:   open | resolved | → promoted to <file>
```

Sections, in fixed order in every file:

| Section | For |
|---|---|
| What Works | an approach that was tried and held up — reuse it |
| What Doesn't Work | a dead end or antipattern. **Most valuable, most often left empty** |
| Codebase Patterns | a convention or architectural decision the code does not announce |
| Tool & Library Notes | a quirk of a dependency, CLI, or the local environment |
| Recurring Errors & Fixes | a symptom seen more than once, with its fix |
| Session Notes | a dated summary, only when no single entry captures the session. Sparingly |
| Open Questions | left unresolved, so the next session does not re-derive it |

**Promotion:** an entry that saves us twice becomes a one-line rule in the relevant
`CLAUDE.md`, and its `Status` here becomes `→ promoted to <file>`.

Files are written in English. Keep each under ~250 lines. Over budget, spill to
`docs/insights-archive.md`: verbatim, under the same section, with a `> Archived …` blockquote
left at the foot of the section listing the dates that left. Only `→ promoted` and `resolved`
entries whose lesson has shipped qualify — an `open` entry never moves, and neither does a
resolved one an open entry points at.
