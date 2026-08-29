# L05 — The spec-driven development pipeline

Spec ID: L05-SDD-PIPELINE
Status: draft
Supersedes: none
Owner: devsiteua
Packages touched: none — repository tooling only (`.claude/`, `specs/`, `docs/`, root `CLAUDE.md`)

> This file is written in the format that **In scope** proposes for `specs/TEMPLATE.md`.
> Editing the template is step 6 of the implementation, so for exactly one commit the spec is
> ahead of the template it follows. That is deliberate: reviewing a proposed format is easier
> when something is written in it.

## Problem and user

The user is the person building DevDigest lesson by lesson. Today a feature starts in chat and
the first artefact anyone can read is a **plan** — `planner` interviews the caller for at most
three questions, then plans. What the feature must *do* is never written down as a separate,
reviewable document. Three costs follow, and all three have already been paid in this repo:

- **Requirements are invented mid-plan.** The plan is the only place a requirement appears, so
  a wrong requirement is discovered when the code exists and the review disagrees with it.
  L01–L04 each needed a "Round 2" against the mentor's review — `specs/README.md`'s lesson
  index records four of them.
- **Nothing survives the trip between agents.** A subagent returns only a summary
  (`.claude/agents/README.md`), so a requirement that lives in a chat message is gone by the
  time `implementer` runs. Only a file crosses that boundary.
- **"Done" is unfalsifiable.** `plan-verifier` checks code against a *plan*. When the plan is
  also the requirement, the verifier can only confirm that we built what we decided to build,
  never that we built what was asked.

## Goals / Non-goals

**Goals**

1. A requirement exists as a reviewable file **before** any plan does, written by an agent
   whose only job is *what* and *why*.
2. Every requirement is individually checkable and carries an id that survives into the plan,
   into the test, and into the commit — so "is it done" has a mechanical answer.
3. Running the pipeline is one command over an approved plan, and what the run cost is
   written down afterwards rather than remembered.

**Non-goals**

- **Not an autonomous pipeline.** Every stage stops for the user: the spec is approved by a
  human, the plan is approved by a human, and `/implement` is typed by a human. Nothing here
  chains itself.
- **Not a requirements database.** No status automation, no board, no cross-spec index beyond
  the table already in `specs/README.md`.
- **Not a replacement for the review gate.** `/pr-self-review` stays the thing that decides
  whether a pull request may open; this pipeline produces the diff it judges.

## Context

What already exists, and is therefore not built again:

| Already true | Where |
|---|---|
| A top-level `specs/` folder whose README states that multi-module specs live there and single-package work goes to `<pkg>/specs/` | `specs/README.md` § Module-local specs |
| A spec template with statuses `draft → in-progress → done \| dropped` | `specs/TEMPLATE.md`, `specs/README.md` rule 5 |
| Eight agents with an explicit `tools` allowlist, a fixed return template each, and a registry that documents both | `.claude/agents/README.md` |
| `plan-verifier`, read-only, item-by-item, with an evidence cell per item | `.claude/agents/plan-verifier.md` |
| A `PreToolUse` hook that filters by `agent_type` and makes "read-only agent" a boundary | `scripts/readonly-agent-guard.sh` |
| The difference between `/pr-self-review` (whole-diff gate, hand-authored here — **not** a built-in) and `architecture-reviewer` (one axis, in depth) | `.claude/agents/README.md` § What is deliberately not here |
| The canonical path → skills routing table both agents point at instead of copying | `.claude/skills/pr-self-review/SKILL.md` §3 |

The lesson brief adds the pipeline itself, and the mentor's session answers fix the details:
specs are top-level, the spec language is English, design sources are supplied by the user,
the clarification round blocks before writing, and the retro skill is manual-only.

## In scope

1. `.claude/agents/spec-creator.md` — new agent: six categories of blocking clarification,
   design-source analysis, EARS criteria, `[NEEDS CLARIFICATION]` instead of a guess, one
   file written, and that file under `specs/`.
2. `.claude/agents/planner.md` → `.claude/agents/implementation-planner.md` — renamed and
   rewritten: takes a spec path, reviews the requirements and names their gaps, asks only
   *how* questions, tags every step with `Covers: AC-NN`, asks single-agent vs multi-agent,
   and closes with recommendations.
3. `.claude/agents/plan-verifier.md` — takes **two** paths (spec and plan) and returns an
   `AC → task → test → commit` matrix.
4. `.claude/skills/implement/SKILL.md` — new `/implement` command that runs an approved plan:
   implementer → architecture review → fix iterations → verification → plan verification.
5. `.claude/skills/workflow-retro/SKILL.md` + `docs/retro/ledger.md` — new manual `/workflow-retro`
   command that reports what a run cost and proposes concrete changes. The ledger is a new
   file under `docs/`, so `docs/README.md` § Index gains a row for it naming `/workflow-retro`
   as its owner — the same shape `insights-archive.md` already has, and required by
   `docs/README.md` § Adding a document, rule 4.
6. `specs/TEMPLATE.md` — the merged SDD spec template (see AC-32).
7. `specs/README.md` — the EARS convention, the `AC-NN` rule, the `[NEEDS CLARIFICATION]`
   status gate, `Spec ID`/`Supersedes`, and where plans live.
8. root `CLAUDE.md` — the one language exception, the pipeline in § Session protocol, and
   the two new hand-authored skills added to the § Do not touch list that names which
   `.claude/skills/` entries are ours to edit and must stay out of `skills-lock.json`.
9. `.claude/agents/README.md` and `.claude/skills/README.md` — catalog, permissions table,
   artefact table and flow diagram, updated for one new agent and two new skills.
10. `specs/README.md` — the EARS reference itself: what the five patterns are, who
    published them and where, and one example of each in this repository's trigger
    vocabulary. Verbatim source in the Appendix below; `spec-creator` points at this
    section rather than carrying a second copy of the explanation.

## Out of scope

- **The L05 features themselves** — Project Context Folder and Onboarding Generator. They get
  their own specs, written **by `spec-creator`**, because demonstrating the pipeline on a real
  feature is what the lesson checks. Specifying them here by hand would defeat the exercise.
- **Moving test execution out of `implementer`.** The mentor named the token cost out loud and
  did not change it. Removing verification from the agent that writes the code changes its
  contract mid-lesson, in the same lesson where that agent builds two features. Candidate for
  L06 — recorded in Open questions with a concrete proposal.
- **Automatic invocation of anything.** No hook that runs the retro, no agent that calls
  another (see Non-goals).
- **A model-cost dashboard.** The retro ledger is a markdown file, not a feature in the product.
- **Touching the historical specs.** `specs/L03-*.md`, `specs/four-new-subagents.md` and the
  rest keep saying `planner`; they are a record of what was true then (`specs/README.md` rule 5).

## User stories

- As the person starting a feature, I want an agent that interrogates me before it writes
  anything, so that the requirements are mine and not its guesses.
- As the person reviewing a spec, I want every requirement numbered and individually
  checkable, so that approving it is a decision and not a vibe.
- As the person planning, I want the requirements handed to me as a file so that I plan *how*
  and never re-litigate *what*.
- As the person running the work, I want one command over an approved plan, and a report at
  the end that says which requirement is met and which is not.
- As the person paying for tokens, I want to know after each run how much it cost and which
  agent wasted the most, so that the next run is cheaper.
- As the person who arrives with **no design and no answers**, I want the agent to stop and
  ask rather than invent a screen — and to leave the holes visible in the file if I insist it
  proceeds.

## Acceptance criteria (EARS)

| AC-ID | Pattern | Criterion | How it is checked |
|---|---|---|---|
| AC-01 | ubiquitous | Система повинна (shall) містити агента `spec-creator`, чий файл оголошує `name`, `description` з тригерами українською й англійською, явний список `tools` і `model`. | `head -6 .claude/agents/spec-creator.md` |
| AC-02 | ubiquitous | `tools` агента `spec-creator` повинен (shall) містити читання репозиторію, `Write`, `Edit`, `Skill` і чотири read-only MCP-інструменти, і не повинен (shall) містити `run_agent_on_pr`, `WebSearch`, `WebFetch` чи `Task`. | `grep '^tools:' .claude/agents/spec-creator.md` |
| AC-03 | event-driven | КОЛИ `spec-creator` отримує задачу, він повинен (shall) поставити блокуючий раунд уточнень за шістьма категоріями — обсяг, актори, дані й контракти, дизайн і взаємодія, деградована поведінка, нефункціональні межі — і не записати жодного файлу, доки не отримає відповіді. | ручний прогін агента; § Step 0 у файлі агента |
| AC-04 | unwanted | ЯКЩО користувач відповідає «дій на свій розсуд», ТОДІ `spec-creator` повинен (shall) записати кожне взяте припущення як `[NEEDS CLARIFICATION: питання]`, а не як вимогу. | ручний прогін: відповідь «best guess» → у файлі є маркери |
| AC-05 | state-driven | ПОКИ у файлі спеки лишається хоч один `[NEEDS CLARIFICATION: …]`, статус спеки повинен (shall) лишатися `draft`. | `specs/README.md` rule 5; перевірка на створеній спеці |
| AC-06 | event-driven | КОЛИ користувач передає джерела дизайну — текстовий опис, посилання на Figma, наявний код або репозиторій — `spec-creator` повинен (shall) розібрати їх і перелічити чотири речі: стани, яких немає в макеті; непокриті кутові випадки; спосіб спілкування задіяних модулів; запропоновані покращення UX. | розділ `Design analysis` у створеній спеці містить усі чотири підрозділи |
| AC-07 | unwanted | ЯКЩО для екрана, про який ідеться, джерела дизайну відсутні, ТОДІ `spec-creator` повинен (shall) позначити кожне рішення щодо цього екрана як похідне і поставити `[NEEDS CLARIFICATION]`, а не вигадати макет. | ручний прогін без дизайну |
| AC-08 | event-driven | КОЛИ `spec-creator` записує файл, шлях повинен (shall) бути `specs/<name>.md` для фічі, що зачіпає більше одного пакета, або `<pkg>/specs/<name>.md` для одномодульної. | `specs/README.md` § Module-local specs; шлях створеного файлу |
| AC-09 | unwanted | ЯКЩО для вимоги бракує зовнішньої інформації, ТОДІ `spec-creator` повинен (shall) повернути перелік дослідницьких питань у своєму звіті і не запускати жодного субагента. | `grep -c 'Task' .claude/agents/spec-creator.md` у рядку `tools:` → 0 |
| AC-10 | ubiquitous | Кожен критерій приймання у створеній спеці повинен (shall) мати `AC-NN`, рівно один із п'яти патернів EARS і заповнену колонку `How it is checked`. | огляд створеної спеки; § Step 7 self-check у файлі агента |
| AC-11 | ubiquitous | Агент-планувальник повинен (shall) називатися `implementation-planner`, і жодне посилання в `.claude/`, `CLAUDE.md`, `scripts/` чи `server/test/` не повинне (shall) вказувати на старе ім'я. | `grep -rn "\bplanner\b" .claude/ CLAUDE.md scripts/ server/test/ \| grep -v implementation-planner` → порожньо |
| AC-12 | event-driven | КОЛИ `implementation-planner` отримує шлях до спеки, він повинен (shall) звірити вимоги і назвати їхні прогалини, суперечності та неоднозначності перед тим, як планувати. | розділ `Requirements review` у створеному плані |
| AC-13 | unwanted | ЯКЩО `implementation-planner` просять написати або відредагувати специфікацію, ТОДІ він повинен (shall) відмовитись і повернути прогалину до `spec-creator`. | § Hard rules у файлі агента; `Write` дозволений лише для файлу плану |
| AC-14 | ubiquitous | Кожен крок плану повинен (shall) містити рядок `Covers: AC-NN`, а план повинен (shall) закінчуватися таблицею покриття, у якій кожен AC зі спеки трапляється щонайменше один раз. | таблиця покриття в кінці створеного плану |
| AC-15 | event-driven | КОЛИ план готовий, `implementation-planner` повинен (shall) запитати, виконувати його одним агентом чи мультиагентним прогоном, і записати відповідь у розділ `Handoff`. | розділ `Handoff` створеного плану |
| AC-16 | ubiquitous | План повинен (shall) закінчуватися розділом рекомендацій — що в задачі можна зробити краще, ніж просить спека. | розділ `Recommendations` створеного плану |
| AC-17 | event-driven | КОЛИ `plan-verifier` отримує шлях до спеки і шлях до плану, він повинен (shall) повернути таблицю `AC-ID → крок плану → тест → коміт`, де кожен рядок має вердикт і клітинку доказу. | ручний прогін після реалізації |
| AC-18 | unwanted | ЯКЩО спеки немає, ТОДІ `plan-verifier` повинен (shall) перевіряти лише за планом і сказати вголос, що колонка AC порожня. | ручний прогін лише з планом |
| AC-19 | ubiquitous | Система повинна (shall) містити скіл `/implement`, який виконує затверджений план. | `ls .claude/skills/implement/SKILL.md` |
| AC-20 | unwanted | ЯКЩО виклик `/implement` не містить шляху до файлу плану, ТОДІ скіл повинен (shall) зупинитись і запитати шлях, не запускаючи жодного агента. | виклик без аргументу |
| AC-21 | ubiquitous | `/implement` не повинен (shall) запускати ані `spec-creator`, ані `implementation-planner` — обидва запускаються вручну й окремо. | § Scope у файлі скіла; `grep -c 'spec-creator' .claude/skills/implement/SKILL.md` у секції запуску → 0 |
| AC-22 | event-driven | КОЛИ `architecture-reviewer` повертає знахідки, `/implement` повинен (shall) запустити ітерацію виправлень і повторний рев'ю, і зупинитися, коли не лишилося знахідок рівня CRITICAL або коли вичерпано дві ітерації. | § Loop у файлі скіла; прогін на реальному плані |
| AC-23 | state-driven | ПОКИ виконується `/implement`, `architecture-reviewer` і `plan-verifier` повинні (shall) запускатися на моделі `sonnet` — перевизначенням на виклику, без зміни рядка `model:` у їхніх файлах. | `grep '^model:' .claude/agents/{architecture-reviewer,plan-verifier}.md` → `opus`; скіл передає `model: sonnet` |
| AC-24 | optional | ДЕ передано прапорець `--tests`, `/implement` повинен (shall) запустити `test-writer`; за замовчуванням цей крок пропускається задля бюджету. | § Flags у файлі скіла |
| AC-25 | ubiquitous | `/implement` повинен (shall) виконати typecheck, юніт-тести й `arch:check` для кожного зачепленого пакета незалежно від переданих прапорців. | § Verification у файлі скіла |
| AC-26 | ubiquitous | Система повинна (shall) містити скіл `/workflow-retro`, який запускається лише вручну. | `ls .claude/skills/workflow-retro/SKILL.md`; відсутність згадок у `.claude/settings.json` |
| AC-27 | unwanted | ЯКЩО `/workflow-retro` не викликано явно користувачем, ТОДІ він не повинен (shall) виконуватись — жодного автоматичного тригера, жодного виклику з `/implement`. | `grep -c 'workflow-retro' .claude/skills/implement/SKILL.md` → 0 |
| AC-28 | event-driven | КОЛИ `/workflow-retro` завершує аналіз, він повинен (shall) вивести підсумок у чат і дописати один запис у `docs/retro/ledger.md`. | файл журналу після прогону |
| AC-29 | ubiquitous | Запис у журналі повинен (shall) містити дату, шлях до плану, кількість запущених агентів і порядок їх запуску, витрачені токени, що далося легко, що — важко, яка інформація дублювалася і що було пропущено. | шаблон запису у файлі скіла |
| AC-30 | ubiquitous | `/workflow-retro` повинен (shall) закінчуватись переліком конкретних пропозицій, кожна з яких називає файл агента або скіла, який треба змінити. | розділ `Proposals` у виводі |
| AC-31 | optional | ДЕ передано `deep`, `/workflow-retro` повинен (shall) додатково прочитати журнали прогону з диска; за замовчуванням він працює лише з тим, що є в контексті сесії. | § Modes у файлі скіла |
| AC-32 | ubiquitous | `specs/TEMPLATE.md` повинен (shall) містити секції Problem and user · Goals/Non-goals · Context · In scope · Out of scope · User stories · Acceptance criteria (EARS) · Edge cases · Design analysis · Non-functional requirements · Inputs and provenance · Untrusted inputs · Test plan · Risks · Open questions. | `grep -c '^## ' specs/TEMPLATE.md` → 15 |
| AC-33 | ubiquitous | Таблиця критеріїв приймання повинна (shall) бути написана українською з тригерами КОЛИ · ПОКИ · ЯКЩО · ДЕ, решта файлу спеки — англійською, і цей виняток повинен (shall) бути записаний у `CLAUDE.md` § Conventions. | `grep -n 'EARS' CLAUDE.md` |
| AC-34 | ubiquitous | `.claude/agents/README.md` повинен (shall) описувати конвеєр: каталог, таблицю дозволів, таблицю артефактів і схему потоку — з новим агентом і новим ім'ям планувальника. | огляд файлу |
| AC-35 | ubiquitous | Файл `.claude/agents/spec-creator.md` не повинен (shall) перевищувати 320 рядків, а блокуючий раунд — 4 питання на категорію. | `wc -l`; § Step 0 у файлі агента |
| AC-36 | ubiquitous | `docs/README.md` § Index повинен (shall) містити рядок для `docs/retro/ledger.md` із зазначеним власником `/workflow-retro`, а `CLAUDE.md` § Do not touch — обидва нові рукописні скіли. | `grep -n 'ledger' docs/README.md`; `grep -n 'workflow-retro' CLAUDE.md` |
| AC-37 | unwanted | ЯКЩО новий скіл потрапляє в `skills-lock.json`, ТОДІ це помилка: рукописні скіли повинні (shall) лишатися поза локом. | `grep -c 'implement\|workflow-retro' skills-lock.json` → 0 |
| AC-38 | ubiquitous | `specs/README.md` повинен (shall) містити довідник EARS: п'ять патернів, по одному прикладу на кожен українською, і атрибуцію — автори, конференція, рік, посилання на оригінальну публікацію. | `grep -n 'Mavin' specs/README.md`; огляд розділу |

## Edge cases

- **A task with no design at all.** The pipeline must still produce a spec; every screen
  decision is marked derived (AC-07).
- **A task that is not plannable** — a topic rather than a change. `spec-creator` returns the
  clarification block and nothing else; no half spec accompanies questions.
- **A spec that already exists for the feature.** Extend it; never open a rival file with a
  similar name. A `done` spec is never rewritten — a new one carries `Supersedes:`.
- **The API on `:3001` is down**, so every MCP call fails. The agent says so in one line and
  continues from the code; a failed lookup is never reported as an absent feature.
- **The plan covers an AC that the spec later drops.** The coverage table has a row with no
  source; `plan-verifier` reports it as scope creep rather than silently passing.
- **`/implement` on a plan whose spec has open `[NEEDS CLARIFICATION]`.** The skill refuses to
  start: a `draft` spec is not an approved one.
- **Two architecture-review iterations end with a CRITICAL still open.** The skill stops,
  reports, and hands back — it never opens a pull request and never loops a third time.
- **A retro with no run in context.** `/workflow-retro` says there is nothing to analyse
  rather than inventing numbers; `deep` is the way to get data from disk.

## Design analysis

This change has **no user interface**: nothing here renders, and no artboard in the design
reference corresponds to it. What replaces a design analysis is an analysis of how the parts
talk to each other, because that is where this design can actually fail.

**How the modules talk.** Every hop is a file on disk, never a message, because a subagent
returns only a summary (`.claude/agents/README.md`, opening paragraphs):

```
user + design sources ─► spec-creator ─► specs/<name>.md
                                              │
                                              ▼
                              implementation-planner ─► specs/plans/<name>.md
                                              │
                                              ▼
                        /implement ─► implementer ─► code
                                         │
                                         ├─► architecture-reviewer ─► findings ─┐
                                         │            ▲                          │
                                         │            └──── fix iteration ◄──────┘
                                         ├─► test-writer            (only with --tests)
                                         └─► plan-verifier ─► AC → task → test → commit
                                              │
                                   /workflow-retro ─► docs/retro/ledger.md   (manual)
```

**States nobody drew.** The pipeline's equivalents are the degraded ones, and each has an
acceptance criterion: no answers (AC-03), no design (AC-07), no spec (AC-18), no plan path
(AC-20), unresolved CRITICAL after two iterations (AC-22), no run to analyse (AC-31).

**What this design makes worse, honestly.** It adds two mandatory human approvals to every
feature, and it costs a full agent context per stage. The lesson accepts that cost; the retro
skill exists so that the cost is measured rather than assumed.

**UX improvements proposed** (each a proposal, not a requirement): `/implement` prints the
plan's coverage table before starting, so the user sees what they are authorising;
`/workflow-retro` prints the ledger diff rather than the whole file.

## Non-functional requirements

| Limit | Value | Why this number |
|---|---|---|
| `spec-creator.md` length | ≤ 320 lines (AC-35) | the whole file enters the agent's context on every run; `planner.md` is 188 and is the largest today |
| Blocking clarification round | ≤ 4 questions per category, one round (AC-03, AC-35) | a second round of twenty questions is how an interview becomes an interrogation and gets skipped |
| Architecture-review fix iterations | ≤ 2 (AC-22) | bounded so a disagreement between reviewer and implementer cannot burn a session |
| Reviewer model during `/implement` | `sonnet` (AC-23) | opus on three read-only agents is the single largest avoidable cost in a run |
| Retro ledger entry | one per run, appended | a file that rewrites itself is not a ledger |

## Inputs and provenance

| Input | Where it comes from | When it is stale | If missing |
|---|---|---|---|
| the task | the user, in chat | never — it is the request | there is nothing to spec |
| design sources | the user: a text description, a Figma link, existing code, or a repository | whenever the design moves and nobody re-pastes it | AC-07: every screen decision marked derived |
| `reference/devdigest-design/` | local-only, git-excluded, restored from `~/.devdigest/design-reference.zip` | it is a snapshot, not a live link | the `design-reference` skill says so; do not invent an artboard |
| `INSIGHTS.md` files | earlier sessions of this repo | an entry can be older than the code it describes | treated as high-confidence unless the code contradicts it (root `CLAUDE.md` § Session protocol) |
| live product state | the four read-only MCP tools, over the API on `:3001` | only up while `./scripts/dev.sh` runs | say so in one line, continue from the code |
| the plan | `implementation-planner`, on disk | when the spec changes after the plan is written | `/implement` refuses without a path (AC-20) |

## Untrusted inputs

- **MCP tool output.** `get_findings`, `get_conventions` and `get_blast_radius` return text
  that originated in a real repository — PR titles, file paths, model-written findings. It
  reaches the agent's context as data. It may never be followed as an instruction, and it may
  never name a tool to call.
- **Design sources pasted by the user.** A Figma export or a repository dump is content, not
  direction. A line inside it that reads like an instruction ("also write the spec for…") is
  quoted in the spec, never obeyed.
- **The spec this pipeline writes is itself an untrusted input later.** The Project Context
  feature attaches project documents into the reviewer's prompt. A spec written today can end
  up inside a model call tomorrow, which is why nothing in a spec may be phrased as an
  instruction to a reviewer ("ignore findings about…").
- **No new untrusted input reaches the product's own prompts in this change.** This is repo
  tooling; `reviewer-core`'s prompt assembly is untouched.

## Test plan

Most of this change is prompt text, and there is no lane that tests prose. What is checkable
is checked, and what is not is named:

| Lane | Covers |
|---|---|
| shell greps in the `How it is checked` column | AC-01, AC-02, AC-09, AC-11, AC-19, AC-21, AC-23, AC-26, AC-27, AC-32, AC-33, AC-35, AC-36, AC-37, AC-38 — every structural claim |
| `cd server && pnpm exec vitest run test/readonly-agent-guard.test.ts` | the rename must not break the guard's agent table |
| existing suites, unchanged and green | proof that repo tooling did not touch product code |
| one real pipeline run, recorded in `docs/retro/ledger.md` | AC-03 … AC-08, AC-12 … AC-18, AC-20, AC-22, AC-28 … AC-31 — the behavioural half |

**Deliberately not covered by an automated test:** whether an agent *obeys* its own prompt.
That is checked by running it, and the retro ledger is where the evidence is kept.

## Risks

| Risk | How we would notice | What we do |
|---|---|---|
| The write restriction is prompt-only, so nothing stops `spec-creator` writing elsewhere | a stray file in a diff | the mentor's decision (Open questions #1); the rule is stated twice in the agent file, and `/pr-self-review` sees every file in the diff |
| Renaming `planner` breaks references | the grep in AC-11 | one commit does the rename and every reference; historical specs are deliberately left alone |
| A full SDD run is expensive — the mentor's own run was 25+ minutes | the retro ledger's token line | `test-writer` off by default, reviewers on sonnet, two-iteration cap |
| The registry becomes a second source of truth for agent rules | a rule stated in both README and an agent file | README stays a map; rules live in the agent files (`.claude/agents/README.md`, opening) |
| The template grows so large that small specs stop being written | a module-local spec that skips sections | rule 2 allows "none" as an answer; the sections stay, the prose does not have to |
| Two sessions editing `.claude/` at once | conflicting edits in `git status` | one session owns this branch at a time — this already happened once during this lesson |

## Open questions

**None open.** The five questions this spec raised were answered on 2026-08-29, before any
implementation started. They are recorded here with their reasons, because a decision without
its reason turns into a rule nobody can revisit.

1. **The write restriction is a prompt rule, not a hook.** As the mentor decided — "лише
   правила у промті". This repo's registry argues the opposite in general ("the absence of
   `Edit` from `planner` is a property of the process, not a promise in prose"), and
   `scripts/readonly-agent-guard.sh` already filters by `agent_type`, so the guard would be
   roughly twenty lines plus a test. It is **not built now**; if a stray write ever appears in
   a diff, that is the trigger to add it as its own commit. The rule is stated twice in the
   agent file, and `/pr-self-review` sees every file in a diff.
2. **`spec-creator` does not spawn anything.** The mentor wanted a parallel
   Investigator/Researcher fan-out from the spec stage; the registry forbids agent chains
   ("None of the eight can spawn another"). Resolution: `spec-creator` returns a list of
   research questions, and the **main session** fans them out to parallel `researcher` runs.
   Same outcome, registry rule intact.
3. **`plan-verifier` runs after the fix iterations**, because it verifies finished code —
   running it before the fixes verifies a tree that is about to change. What moves earlier is
   the coverage check: `implementation-planner` proves every AC has a step before `/implement`
   starts, so a missing requirement is caught at planning time rather than at verification.
4. **The command is `/implement`** — the short, action-shaped name the mentor asked for. Our
   earlier working name `/run-plan` is retired.
5. **Test execution stays inside `implementer`** for this lesson (see Out of scope). Concrete
   proposal carried into L06: `/implement` runs typecheck, unit and `arch:check` itself
   between steps, and `implementer` returns a diff plus the commands it *would* run. That
   halves the implementer's context but changes its published contract, which is why it does
   not happen in the lesson where that same agent builds two features.

## Deviations from the recorded plan, and from the video

Named here so that neither reads later as an oversight:

| Source | It says | We do | Why |
|---|---|---|---|
| video | spec ID is a date plus a feature name | `L0X-kebab-case-name.md`, `Spec ID` = the slug upper-cased | `specs/README.md` rule 1; twelve existing specs already follow it |
| video | statuses `draft → approved → implemented` | `draft → in-progress → done \| dropped` | rule 5; `approved ≈ in-progress`, `implemented ≈ done` is recorded in the README |
| video | `architecture-reviewer` is switched to sonnet in its own file | overridden at the call inside `/implement` | the registry's reason for `model: opus` stays true and readable |
| video | `test-writer` is dropped entirely | off by default, `--tests` turns it on | the lesson brief says not to disable every check |
| plan | skill named `/run-plan` | `/implement` | the mentor asked for the shorter, action-shaped name |
| plan | ledger at `docs/retros/ledger.md` | `docs/retro/ledger.md` | the mentor's spelling |
| plan | `spec-creator` never spawns anything | unchanged, but the main session fans out researchers | Open questions #2 |
| L01–L04 specs | carry `Constraints in force`, `Implementation plan`, `Commit plan` and `Handoff` **inside the spec file** | those four sections live in `specs/plans/L05-sdd-pipeline.md` | `AC-13`: `implementation-planner` may never edit a spec. With the plan inside the spec, the planner cannot write a plan without breaking that rule — so the lesson that makes the separation a rule is the lesson that has to split the file. The sections themselves are unchanged, and none was dropped |

## Appendix — the EARS reference this pipeline adopts

The text below is the source material for **In scope** item 10. It lands in `specs/README.md`
as its own section during implementation; it is carried here so that step copies rather than
paraphrases it.

**EARS** — *Easy Approach to Requirements Syntax* — is a way of phrasing a requirement that
separates the condition from the system's response. Alistair Mavin, Philip Wilkinson, Adrian
Harwood and Mark Novak, then at Rolls-Royce, presented it at the 17th IEEE International
Requirements Engineering Conference (RE'09) in 2009.

Five patterns. The trigger words are Ukrainian and `shall` stays in brackets as the marker of
an obligation — that pairing is this course's local convention, not part of EARS itself:

| Pattern | When to use it | Example |
|---|---|---|
| **Ubiquitous** | the requirement always holds | Система повинна (shall) журналювати кожну спробу автентифікації. |
| **Event-driven** | a response to something that happens | КОЛИ користувач надсилає форму входу, система повинна (shall) перевірити облікові дані. |
| **State-driven** | behaviour that holds while a state lasts | ПОКИ триває синхронізація, система повинна (shall) показувати прогрес. |
| **Unwanted behaviour** | a response to an undesirable condition | ЯКЩО перевірка тричі не вдалася за 60 секунд, ТОДІ система повинна (shall) тимчасово заблокувати обліковий запис. |
| **Optional feature** | behaviour that exists only behind an enabled option | ДЕ ввімкнено MFA, система повинна (shall) вимагати TOTP-код після пароля. |

What the patterns are for, in one line: a criterion that names its trigger can be failed by a
test, and one that does not can only be argued about.

| Vague | Checkable |
|---|---|
| «має нормально працювати на великих репозиторіях» | КОЛИ репозиторій перевищує поріг індексації, система повинна (shall) будувати огляд лише з детермінованих фактів, не читаючи всі файли повністю. |
| «не має падати, якщо модель недоступна» | ЯКЩО структурований виклик моделі не вдався, ТОДІ система повинна (shall) показати детермінований огляд із причиною деградації. |
| «має підказувати, з чого почати читати» | Система повинна (shall) впорядкувати reading path за рангом файлів у графі імпортів. |

**Citation to carry across.** Alistair Mavin, Philip Wilkinson, Adrian Harwood, Mark Novak,
*Easy Approach to Requirements Syntax (EARS)*, 17th IEEE International Requirements
Engineering Conference (RE'09), Atlanta GA, 31 August – 4 September 2009, pp. 317–322. Record:
<https://research.manchester.ac.uk/en/publications/easy-approach-to-requirements-syntax-ears/>.
EARS came out of Rolls-Royce, where the authors were analysing airworthiness regulations for a
jet engine control system — which is why its patterns are built around conditions and
obligations rather than around user stories.
