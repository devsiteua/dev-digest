# Retro ledger — what each pipeline run cost

One entry per multi-agent run, appended by `/workflow-retro` and by nothing else. Newest
last. Entries are **never rewritten**: the whole value of this file is that run seven can be
compared with run three, and a file that tidies its own history cannot do that.

**Not `INSIGHTS.md`.** That journal records what we learned about the *code*; this one records
what we learned about the *run* — which agents, in which order, at what cost. A lesson about
Drizzle belongs there. A lesson about `implementer` re-reading the same six files in every
context belongs here.

**Not a dashboard.** It is a markdown file. Nothing parses it, nothing charts it, and no
number in it is authoritative beyond what the entry itself says it measured.

## Entry template

```markdown
## <YYYY-MM-DD> — <feature in one line>

**Plan:** `specs/plans/<slug>.md` · **Spec:** `specs/<slug>.md` · **Mode:** default | deep
**Agents:** N launched — `a → b → a → c`
**Tokens:** <total> · <per agent, largest first> · cache reads <n>, counted separately

- **Easy:** <the stages that needed no correction>
- **Hard:** <every place a human intervened, a step went red, an iteration was spent>
- **Duplicated:** <the same file, convention or finding paid for twice, with the number>
- **Missed:** <what the run should have caught and did not, and who caught it instead>

**Proposals**
1. <change> → `<path/to/file.md>` § <section>
   Because: <the measurement above>   Costs: <what gets worse>
```

Any field that was not measured is written `not measured`. An estimate written as a number is
worse than a gap, because the next entry will be compared against it.

## Entries

_None yet. The first run of the pipeline writes the first one._
