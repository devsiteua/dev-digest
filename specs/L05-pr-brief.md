# L05 — PR Brief (Why + Risk)

Spec ID: L05-PR-BRIEF
Status: in-progress
Supersedes: none
Owner: devsiteua
Packages touched: server, client, e2e (`@devdigest/shared` contracts in both mirror copies)

> Every section stays, even when the honest answer is "none". A deleted section reads as an
> oversight; the word "none" is a claim someone can disagree with.
> The implementation plan does **not** live here — it lives in `plans/L05-pr-brief.md`
> alongside this file. See `README.md` § Where plans live.

## Problem and user

A reviewer opening PR #482 today has four separate answers to four separate questions and no
one place that puts them together. The Overview tab shows what the PR *claims* to be for
(`IntentCard`, L03). The Blast tab shows what its diff can *reach* (L04). The Files tab shows
the diff in reviewer order (L03 Smart Diff). The Findings tab shows what agents *said*. None
of them answers the question a reviewer actually opens a PR with — **why is this change being
made, what could it break, and where should I start reading** — so that answer is reassembled
by hand on every PR, and the two most expensive inputs to it (the derived intent and the blast
map) are already sitting in the database unused. The evidence that this was always the
intended shape is in the tree: `pr_brief` exists with zero writers
(`server/src/db/schema/reviews.ts:120-125`), a `PrBrief` contract exists with zero consumers
(`server/src/vendor/shared/contracts/brief.ts:187-196`), and `client/messages/en/brief.json`
carries a copy namespace nothing renders — the outline a cut feature leaves behind (root
`INSIGHTS.md`, 2026-08-02).

## Goals / Non-goals

**Goals**

1. One `PrBriefCard` at the top of the Overview tab answers *what · why · how risky · where to
   look first* for a pull request, from data the product already holds.
2. Exactly one structured model call produces the brief, and it happens only when a human
   presses a button — never on page load, never as a side effect of a review.
3. Every file, endpoint and job the brief names is one the input data actually contained;
   anything else is dropped before the record is stored, and the drop is visible.
4. The model's input is bounded by a stated number in a stated unit, enforced *before* the
   call, so a large pull request cannot silently become an expensive one.
5. Re-opening a pull request whose inputs have not moved costs nothing: the stored brief is
   served, and the server can prove no model call was made.
6. A brief generated at an earlier state is not thrown away — the card exposes the earlier
   briefs as a **Why Timeline**, with a deterministic statement of what changed between them.
7. A `review focus` row for a file is a link that lands on that file, at that line, in the
   Files tab, and survives a reload.

**Non-goals**

- **A verdict.** The brief describes and orients; it does not approve, block, or score. The
  score belongs to a review (`VerdictBanner`), and a second, cheaper, ungrounded opinion next
  to it would be read as a competing one.
- **A second reviewer.** The brief never reads hunk bodies, so it cannot find a defect and
  must not phrase anything as one. Findings come from `reviewer-core`.
- **Auto-generation.** No background job, no generation during a review run, no generation on
  first paint. A model call in this product happens because somebody asked for it.
- **A repository-wide history of intent.** The Why Timeline is per pull request, built from
  this feature's own rows. The design's `HistoryAccordion` ("Prior PRs touching these files")
  is a different feature with a different data source and is not built here.
- **A second opinion on the blast map.** The brief consumes `GET /pulls/:id/blast`'s answer
  as given, including its `status` and `reason`. It never re-derives, re-ranks or "improves"
  it.

## Context

What already exists and is therefore not built again.

| Already true | Where |
|---|---|
| `pr_brief` table exists and is unused: `pr_id` PK + `json` jsonb, zero writers | `server/src/db/schema/reviews.ts:120-125` |
| `Risk` / `Risks` / `RiskSeverity` contracts exist with zero consumers; `Risk.kind` is an open `z.string()` and `file_refs` a `string[]` | `server/src/vendor/shared/contracts/brief.ts:120-136` |
| Legacy `PrBrief` composite `{ intent, blast, risks, history }` exists, unused | `server/src/vendor/shared/contracts/brief.ts:187-196` |
| The intent layer is done and brokered: `GET/POST /pulls/:id/intent`, `container.intent.get()`, `PrIntentRecord` carrying kind, tier, sources, evidence, `missing_context`, `head_sha` | `server/src/modules/intent/{routes,service}.ts`, `contracts/review-api.ts:82-117` |
| The blast map is done: `GET /pulls/:id/blast` → `BlastRadiusResponse` (`changed_symbols`, `downstream[{symbol, callers[{name,file,line}], endpoints_affected, crons_affected}]`, `summary`, `status`, `reason`, `indexed_sha`) | `server/src/modules/blast/{routes,service}.ts`, `contracts/review-api.ts:165-172` |
| `BlastService` is instantiated inside `modules/blast/routes.ts` and is **not** on `Container`, explicitly because nothing else consumed it | `server/src/modules/blast/routes.ts` (the header comment) |
| Project Context is done and brokered: `container.projectContext.listForPrompt(ws, repoId)` returns enabled documents with bodies, in the user's order | `server/src/platform/container.ts:181-185`, `server/src/modules/context/service.ts:86-92` |
| Diff stats without hunk bodies: `pull_requests.additions/deletions/files_count`, `pr_files.path/additions/deletions` — `pr_files.patch` is the body | `server/src/db/schema/pulls.ts:5-45` |
| Linked-issue resolution: `extractLinkedIssue(body, repoFullName)` over three keyword patterns, and `GitHubClient.getIssue(ref, n)` | `server/src/modules/intent/{helpers.ts:169-179,constants.ts}`, `server/src/adapters/github/octokit.ts:351-364` |
| Token counting: `container.tokenizer.count(text)` — js-tiktoken `cl100k_base`, `ceil(chars/4)` fallback. Its own doc comment scopes it to `modules/repo-intel` | `server/src/adapters/tokenizer/index.ts`, `server/src/platform/container.ts:231-235` |
| The one structured-call shape: `llm.completeStructured({ model, schema, schemaName, messages, temperature, timeoutMs })` → `{ data, tokensIn, tokensOut, costUsd, attempts }` | `server/src/vendor/shared/adapters.ts:55-88` |
| A module written after `FeatureModelId` keeps a module-local model constant instead of widening that closed five-value enum, with the reasoning written out | `server/src/modules/blast/constants.ts` (`BLAST_EXPLAIN_MODEL`) |
| A grounded prompt that forbids invention: "Use ONLY the symbols, files, endpoints and jobs listed below. Never name one that is not there" | `server/src/modules/blast/constants.ts` (`BLAST_EXPLAIN_SYSTEM_PROMPT`) |
| `wrapUntrusted(label, content)` is exported from `@devdigest/reviewer-core` and applied by callers that do **not** go through `assemblePrompt` | `reviewer-core/src/prompt.ts:30-34`; `server/src/modules/intent/helpers.ts:466-489`; root `INSIGHTS.md` 2026-08-29 |
| A budget with an honest justification, dropping whole units from the tail and logging what went | `server/src/modules/reviews/constants.ts` (`MAX_SKILLS_CHARS`, `MAX_PROJECT_CONTEXT_CHARS`), `server/src/modules/reviews/inputs.ts:127-140` |
| Money-spending POSTs carry `{ max: 10, timeWindow: '1 minute' }`; cheap GETs do not | `server/src/modules/intent/routes.ts`, `server/src/modules/blast/routes.ts` |
| A route that logs `llmCalls: 0` / `llmCalls: 1` as literals, so the "no model call" claim is readable in one file | `server/src/modules/blast/routes.ts` |
| The Files tab's focus mechanism: `Focus {path,line,token}` local state in `SmartDiffViewer`, `FileCard` jumps on a `focusToken` bump and highlights `[data-line]` | `client/.../SmartDiffViewer/SmartDiffViewer.tsx:43-47,84-110`; `client/src/components/diff-viewer/FileCard/FileCard.tsx:57-127` |
| The page owns the URL: `?tab`, `?trace`, `?findingId`; `setParams` writes several params in one navigation; `setTab` drops `findingId` deliberately | `client/.../pulls/[number]/page.tsx` |
| A card that renders 404 as an `EmptyState` with a CTA rather than an error, and spends money only on the CTA | `client/.../IntentCard/IntentCard.tsx:77-90`; `client/src/lib/hooks/intent.ts` |
| A tab that renders every degraded server answer as itself, with the action that fixes it | `client/.../BlastTab/BlastTab.tsx` |
| The demo PR #482 (nine files, real patches) carries a seeded `pr_intent` row, upserted, outside the `if (!pr)` block, so the card is reviewable with no model call | `server/src/db/seed.ts:393-537,845-905` |
| e2e flows are JSON data under `e2e/specs/*.flow.json` (nine today) and assert seed literals | `e2e/specs/`, root `CLAUDE.md` § Gotchas |
| The copy namespace `brief` exists and is unused (`block.*`, `noRisks`, `noHistory`, `overlap`, `unavailable`, `unavailableHint`) | `client/messages/en/brief.json` |

## In scope

**Contracts (`@devdigest/shared`, and the mirror edit in `client/src/vendor/shared`)**

- `Risk.kind` narrows from `z.string()` to a closed enum: `security`, `db_migration`,
  `breaking_api`, `perf`, `deps`, `other`.
- `ReviewFocusItem` — a discriminated reference: `{ kind: 'file' | 'endpoint', ref, line, why }`,
  `line` present only for `kind: 'file'` and nullable there.
- `PrBriefRecord` — the persisted brief: `pr_id`, `what`, `why`, `risk_level` (reusing
  `RiskSeverity`'s three values), `risks: Risk[]`, `review_focus: ReviewFocusItem[]`,
  `state_key`, `head_sha`, `missing_inputs: string[]`, `dropped_refs: string[]`,
  `trimmed: string[]`, `input_tokens`, plus the call's own accounting (`provider`, `model`,
  `tokens_in`, `tokens_out`, `cost_usd`, `duration_ms`, `generated_at`) on the shape
  `PrIntentRecord` and `BlastExplainResponse` already use.
- `PrBriefTimelineEntry` and `PrBriefDelta` — one earlier brief, and the code-computed
  statement of what changed between it and its predecessor.
- `PrBriefResponse` = `PrBriefRecord` + `stale: boolean` + `history: PrBriefTimelineEntry[]`.

**Server (`server/src/modules/brief/`, a new module in the shape of `modules/blast/`)**

- `GET /pulls/:id/brief` — the most recent stored brief plus `stale` and the timeline. No
  model call, ever. `404` means only "no brief has ever been generated for this PR".
- `POST /pulls/:id/brief` — assemble, count, trim, one structured call, ground, clamp,
  persist, return. Rate-limited `{ max: 10, timeWindow: '1 minute' }`.
- The assembler: intent (read-only, via `container.intent.get`), the blast map, diff stats
  from `pull_requests` + `pr_files` (paths and counts only), the linked issue, and the
  repo's enabled Project Context documents.
- `modules/brief/constants.ts` carrying every number and the two prompts, on the pattern of
  `modules/blast/constants.ts`.
- `BlastService` becomes a brokered `container.blast`, because the condition its own comment
  names for not brokering ("nothing else consumes the blast map") stops being true here.

**Database**

- `pr_brief` widened to a history: surrogate `id`, `pr_id`, `state_key`, `head_sha`,
  monotonic `seq`, `json`, `generated_at`; unique on `(pr_id, state_key)`. Migration
  generated with `pnpm db:generate`.

**Client**

- `PrBriefCard` (a new `_components/PrBriefCard/`), full width, first block of the Overview
  tab, above the existing `IntentCard`.
- A Why Timeline inside that card, listing earlier briefs with their deltas.
- `?file=` / `?line=` query params on the PR detail page, owned by `page.tsx`, passed to
  `DiffTab` → `SmartDiffViewer` → the existing `FileCard` focus mechanism.
- New keys in `client/messages/en/brief.json`.

**Seed and e2e**

- Two `pr_brief` rows for demo PR #482 so the card and the timeline are reviewable,
  screenshot-able and assertable with no provider key.
- One new flow, `10-pr-brief.flow.json`, over the seeded state.

## Out of scope

- **The design's 2-up `BriefCard` grid.** The card is assembled full-width in this pass. The
  grid moves the existing `BlastTab` and `IntentCard` into new containers, and a layout
  refactor of three components is a bigger change than the feature that motivated it.
- **`HistoryAccordion` / "Prior PRs touching these files".** It shares a visual with the Why
  Timeline and nothing else: its data source is prior merged PRs overlapping these paths,
  which nothing computes today. Building it here would be a second feature wearing this one's
  clothes.
- **The legacy `PrBrief` composite contract.** Left exactly as it is, unused. It models a
  different thing — a bundle of four already-served responses — and rewriting a contract with
  no consumers on the way past is how a small change becomes a mirror-edit sweep.
- **Widening `FeatureModelId` to a sixth value, and a Settings row for the brief's model.**
  `modules/blast/constants.ts` already argues this case: two `vendor/shared` mirror edits, the
  client's duplicate registry and a Settings row, for one call behind a button. Module-local
  constant instead.
- **Making the brief an input to the reviewing prompt.** The intent layer already occupies
  that slot. Feeding a second model's prose into every agent's context is a decision with its
  own blast radius and belongs to whoever needs it.
- **Streaming the generation.** One call, one step, no partial output worth streaming — the
  reasoning `POST /pulls/:id/intent` and `POST /pulls/:id/blast/explain` both give.
- **Regenerating a brief automatically when the head moves.** Staleness is *reported*; acting
  on it is the reader's call, because acting on it spends money.
- **Fixing `resolveLinkedIssue`'s loose regex in `adapters/github/octokit.ts:127-136`.** It is
  private, it serves a different caller, and the brief uses `modules/intent`'s stricter
  `extractLinkedIssue` instead. Noted, not touched.
- **`git blame` / `git-why` per line.** `messages/en/brief.json` already carries a `why.*`
  namespace for it. Different feature, different data source; the keys stay untouched.
- **Anything that reads `pr_files.patch`.** Not a limitation to work around — it is the
  feature's defining constraint.

## User stories

- As a **reviewer** opening a pull request I have not seen, I want one card that says what it
  does, why, how risky it is and which three files to read first, so that I can start reviewing
  in thirty seconds instead of reconstructing context across four tabs.
- As a **reviewer**, I want to click a review-focus row and land on that file at that line in
  the Files tab, so that "start here" is an action and not a suggestion.
- As the **person paying for the model**, I want the brief to cost nothing until I press a
  button and nothing again when I re-open the page, so that a browser tab left open overnight
  is not a bill.
- As a **skeptical reviewer**, I want every file and endpoint the brief names to be one I can
  find in the diff or the blast map, so that I can trust the card instead of double-checking it.
- As the **author of a PR that changed three times**, I want to see how the brief read at each
  earlier state, so that a reviewer who left a comment two force-pushes ago can see what moved.
- As **someone arriving with nothing** — a fresh clone, `pnpm db:seed`, no provider key, no
  design context — I want the demo PR's card to be populated and honestly labelled, so that I
  can see the feature without spending anything and without being lied to about freshness.
- As the **next maintainer**, I want the number that bounds the model's input, its unit, and
  what gets dropped first, written down where the code is, so that I can change it with
  evidence instead of re-deriving why it is 8 000.

## Acceptance criteria (EARS)

Written in Ukrainian with the triggers КОЛИ · ПОКИ · ЯКЩО · ДЕ; the rest of the file is
English. Five patterns and the reference: `README.md` § EARS.

| AC-ID | Pattern | Criterion | How it is checked |
|---|---|---|---|
| AC-01 | event-driven | КОЛИ надходить `POST /pulls/:id/brief`, система повинна (shall) зробити РІВНО ОДИН структурований виклик моделі й повернути `PrBriefRecord` з полями `what`, `why`, `risk_level`, `risks[]`, `review_focus[]`. | `brief.it.test.ts` з `MockLLMProvider`, який рахує виклики; лог маршруту містить `llmCalls: 1` |
| AC-02 | ubiquitous | `GET /pulls/:id/brief` повинен (shall) не викликати модель за жодних умов. | `brief.it.test.ts` з LLM-провайдером, що кидає на кожному методі; лог маршруту містить літерал `llmCalls: 0` |
| AC-03 | unwanted | ЯКЩО для цього pull request ніколи не генерували brief, ТОДІ `GET /pulls/:id/brief` повинен (shall) повернути 404 — і 404 повинен (shall) означати тільки це. | `brief.it.test.ts`: 404 на чистому PR; після одного POST — 200 назавжди |
| AC-04 | event-driven | КОЛИ `GET /pulls/:id/brief` повертає запис, система повинна (shall) додати `stale`, обчислене як «`state_key` збереженого запису не дорівнює `state_key`, перерахованому з поточних входів». | `brief.it.test.ts`: POST → GET дає `stale:false`; зміна тіла PR → GET дає `stale:true` без нового виклику моделі |
| AC-05 | ubiquitous | `state_key` повинен (shall) бути SHA-256 точної послідовності байтів, яку буде надіслано моделі (system-повідомлення + зібране user-повідомлення, ПІСЛЯ обрізання), і нічим іншим. | unit-тест асемблера: рядок → хеш; тест, що зміна будь-якого входу змінює хеш |
| AC-06 | ubiquitous | Асемблер повинен (shall) бути чистою функцією своїх входів: без годинника, без випадковості, без залежності від порядку обходу словників — два виклики поспіль на однакових входах дають байт-ідентичний рядок. | unit-тест: дві збірки на однакових фікстурах порівнюються посимвольно |
| AC-07 | state-driven | ПОКИ жоден вхід брифу не змінився, повторне відкриття сторінки pull request повинно (shall) не спричиняти жодного виклику моделі. | e2e `10-pr-brief.flow.json` + `brief.it.test.ts`: GET ×3 при провайдері, що кидає |
| AC-08 | event-driven | КОЛИ `POST` виконано двічі на незмінних входах, система повинна (shall) перезаписати той самий рядок `(pr_id, state_key)`, а не додати другий. | `brief.it.test.ts`: `select count(*) from pr_brief where pr_id = …` дорівнює 1 після двох POST |
| AC-09 | ubiquitous | У вхід моделі повинні (shall) входити тільки: intent, підсумок blast-мапи, статистика дифу (шляхи та лічильники), пов'язана issue та документи Project Context — і НЕ повинні (shall) входити тіла ханків. | unit-тест: зібраний рядок не містить жодного `pr_files.patch` фікстури; grep у `modules/brief/**` не знаходить читання поля `patch` |
| AC-10 | ubiquitous | Бюджет входу повинен (shall) дорівнювати 8 000 токенів, порахованих `container.tokenizer.count` над КОНКАТЕНАЦІЄЮ system-повідомлення й user-повідомлення, і перевірка повинна (shall) відбуватися ДО виклику. | unit-тест сходинок; `brief.it.test.ts` перевіряє, що виклик отримав вхід ≤ 8 000 токенів |
| AC-11 | event-driven | КОЛИ зібраний вхід перевищує бюджет, система повинна (shall) застосувати сходинки обрізання у фіксованому порядку (Project Context з хвоста → тіло issue → рядки blast-мапи → шляхи файлів понад найбільші N → мінімальний вхід) і перерахувати токени після кожної. | unit-тест на кожну сходинку з фікстурою, що перевищує бюджет |
| AC-12 | unwanted | ЯКЩО навіть мінімальний вхід перевищує бюджет, ТОДІ система повинна (shall) відповісти 422 `brief_input_too_large` і НЕ зробити жодного виклику моделі. | `brief.it.test.ts` з провайдером, що кидає: 422, нуль викликів |
| AC-13 | ubiquitous | Кожне відкидання за бюджетом повинно (shall) потрапити і в лог маршруту, і в поле `trimmed` збереженого запису — ніколи мовчки. | `brief.it.test.ts`: `trimmed` непорожній на фікстурі, що перевищує бюджет |
| AC-14 | ubiquitous | Система повинна (shall) записувати поруч і власний підрахунок вхідних токенів (`input_tokens`), і `tokens_in`, повернутий провайдером, не видаючи одне за інше. | огляд контракту + `brief.it.test.ts`: обидва поля присутні й можуть різнитися |
| AC-15 | ubiquitous | Кожен `risks[].file_refs` повинен (shall) належати ФАЙЛОВІЙ половині дозволеного набору: шляхи з `pr_files` цього PR плюс файли з blast-мапи (`changed_symbols[].file`, `downstream[].callers[].file`); суфікс `:рядок` або `:початок-кінець` перевіряється за частиною до першого `:`. | unit-тест grounding-фільтра; `brief.it.test.ts` з відповіддю моделі, що містить вигаданий шлях |
| AC-16 | ubiquitous | Кожен `review_focus[]` з `kind: 'file'` повинен (shall) належати файловій половині набору, а кожен з `kind: 'endpoint'` — ендпойнтовій половині (`downstream[].endpoints_affected` та `downstream[].crons_affected`). | той самий unit-тест, обидві половини |
| AC-17 | unwanted | ЯКЩО модель назвала посилання поза дозволеним набором, ТОДІ система повинна (shall) відкинути саме це посилання БЕЗ повторного промпту, записати його в `dropped_refs` і зберегти решту брифу. | unit-тест: одне валідне й одне вигадане посилання → одне лишилось, одне в `dropped_refs`, викликів моделі один |
| AC-18 | unwanted | ЯКЩО у пункті `review_focus` посилання відкинуто, ТОДІ пункт повинен (shall) зникнути цілком; ЯКЩО у ризика відкинуто всі `file_refs`, ТОДІ ризик повинен (shall) лишитися зі своїм поясненням і порожнім списком посилань. | unit-тест grounding-фільтра на обидва випадки |
| AC-19 | ubiquitous | `risks[].kind` повинен (shall) приймати рівно шість значень — `security`, `db_migration`, `breaking_api`, `perf`, `deps`, `other` — а відповідь моделі з іншим значенням повинна (shall) звестися до `other`, а не відхилити весь бриф. | unit-тест нормалізації; `pnpm typecheck` в обох пакетах після дзеркальної правки |
| AC-20 | ubiquitous | `risk_level` повинен (shall) обчислюватися кодом як найвища `severity` серед ризиків, що пережили grounding (`low`, якщо їх немає); запропонований моделлю рівень приймається, лише якщо він не вищий за обчислений. | unit-тест на трьох випадках (модель нижче / дорівнює / вище) — форма `settleTier` з L03 |
| AC-21 | ubiquitous | Кожен блок тексту, підконтрольного автору PR (тіло PR, заголовок і тіло issue, документи Project Context, текст intent-запису), повинен (shall) бути загорнутий у `wrapUntrusted()` рівно один раз, а system-повідомлення повинно (shall) містити injection-guard і правило англійської мови. | unit-тест: рівно один `<untrusted` на блок у зібраному рядку; тест на присутність guard-речень |
| AC-22 | unwanted | ЯКЩО для PR не виведено intent, ТОДІ система повинна (shall) згенерувати бриф без нього, записати причину в `missing_inputs` і НЕ запускати виведення intent самостійно. | `brief.it.test.ts`: PR без `pr_intent` → 200, `missing_inputs` містить рядок, `container.intent.derive` не викликано |
| AC-23 | unwanted | ЯКЩО blast-мапа повертає `status: 'degraded'`, ТОДІ дозволений набір повинен (shall) складатися лише зі змінених файлів PR, а причина деградації — потрапити в `missing_inputs`. | `brief.it.test.ts` з мапою `degraded` |
| AC-24 | unwanted | ЯКЩО у pull request немає змінених файлів, ТОДІ система повинна (shall) відповісти 422 `brief_no_changed_files` і не робити виклику моделі. | `brief.it.test.ts` на PR без `pr_files` |
| AC-25 | unwanted | ЯКЩО виклик моделі впав або вичерпав таймаут, ТОДІ система повинна (shall) повернути помилку, нічого не записати, і попередній збережений бриф повинен (shall) далі читатися через `GET`. | `brief.it.test.ts`: POST → провайдер кидає на другому POST → GET досі віддає перший запис |
| AC-26 | ubiquitous | `POST /pulls/:id/brief` повинен (shall) нести обмеження `{ max: 10, timeWindow: '1 minute' }`, а `GET` — не нести власного. | огляд маршрутів + тест, що 11-й POST за хвилину отримує 429 |
| AC-27 | ubiquitous | Порядок записів Why Timeline повинен (shall) визначатися монотонним `seq`, а не лише `generated_at`. | `brief.it.test.ts`: два записи, вставлені в ОДНІЙ транзакції (як у сіді), повертаються у детермінованому порядку |
| AC-28 | ubiquitous | `PrBriefDelta` між сусідніми записами повинен (shall) обчислюватися кодом — зміна `risk_level`, додані та зняті заголовки ризиків, додані та зняті посилання review-focus — без жодного виклику моделі. | unit-тест дельти на двох фікстурах |
| AC-29 | event-driven | КОЛИ для одного pull request накопичилося понад 20 записів, система повинна (shall) видалити найстаріші так, щоб лишилося 20. | `brief.it.test.ts`: 21 вставка → 20 рядків, найстаріший зник |
| AC-30 | event-driven | КОЛИ для PR немає жодного брифу, `PrBriefCard` повинна (shall) показати `EmptyState` з CTA і НЕ надсилати `POST` без натискання. | компонентний тест картки (RTL): 404 → `EmptyState`, нуль мутацій до кліку |
| AC-31 | state-driven | ПОКИ збережений бриф позначено `stale`, картка повинна (shall) показувати банер несвіжості з дією Regenerate, а не ховати бриф за порожнім станом. | компонентний тест картки на `stale:true` |
| AC-32 | ubiquitous | `PrBriefCard` повинна (shall) бути першим блоком вкладки Overview на всю ширину, у порядку: заголовок з бейджем рівня ризику та мета-даними виклику й дією Regenerate → `what` і `why` → розділювач → «Risk areas» → розділювач → «Review focus» → Why Timeline. | компонентний тест порядку блоків; візуальна перевірка проти артборда `pr-overview` |
| AC-33 | event-driven | КОЛИ читач натискає пункт review-focus з `kind: 'file'`, застосунок повинен (shall) однією навігацією виставити `?tab=diff&file=<шлях>&line=<рядок>`, розгорнути цей файл і підсвітити рядок. | e2e `10-pr-brief.flow.json`; компонентний тест на один виклик `setParams` |
| AC-34 | state-driven | ПОКИ URL містить `file` (і, за наявності, `line`), перезавантаження сторінки повинно (shall) відновити той самий фокус. | e2e-крок з перезавантаженням |
| AC-35 | unwanted | ЯКЩО `file` в URL не належить дифу цього PR, ТОДІ вкладка Files повинна (shall) показати видиме повідомлення про це, а не мовчки нічого не сфокусувати. | компонентний тест `DiffTab` з невідомим шляхом |
| AC-36 | event-driven | КОЛИ читач змінює вкладку вручну, застосунок повинен (shall) прибрати `file`, `line` і `findingId` з URL — за тим самим правилом, яке `setTab` уже застосовує до `findingId`. | компонентний/юніт-тест `setTab` |
| AC-37 | ubiquitous | Пункт review-focus з `kind: 'endpoint'` повинен (shall) рендеритися як моношрифтове посилання без навігації. | компонентний тест картки |
| AC-38 | optional | ДЕ у репозиторії увімкнено документи Project Context, вони повинні (shall) входити у вхід брифу в порядку користувача і бути ПЕРШИМИ, що відкидається при перевищенні бюджету. | unit-тест першої сходинки; `brief.it.test.ts` з увімкненим і вимкненим документом |
| AC-39 | ubiquitous | Сід повинен (shall) створювати для демо-PR #482 два записи `pr_brief` з `state_key`, який ніколи не може дорівнювати обчисленому SHA-256, тож картка завжди показує їх як несвіжі. | `pnpm db:seed` двічі + `brief.it.test.ts`; e2e-крок перевіряє банер несвіжості й засіяні літерали |
| AC-40 | ubiquitous | Кожен файл `vendor/shared`, який змінює ЦЯ робота — `contracts/brief.ts`, `contracts/review-api.ts` і ті реекспорти `index.ts`, яких потребують нові контракти — повинен (shall) бути байт-ідентичним у серверній і клієнтській копіях; решта дерева, що розійшлася раніше, до цього критерію не належить. | `cmp -s` окремо по кожному з цих файлів (`server/src/vendor/shared/<f>` проти `client/src/vendor/shared/<f>`); `pnpm typecheck` у `server/` і в `client/` — саме він ловить звуження `Risk.kind`, що приїхало лише в одну копію; `scripts/pr-self-review-checks.sh` (`check:contract-mirror`), який порівнює `cmp -s` тільки ті дзеркальні файли, що є в цьому дифі |

## Edge cases

- **No intent derived yet.** Brief generates without it; `missing_inputs` says so; the brief
  never derives one itself, because that would be a second model call the user did not ask
  for. AC-22.
- **Blast map `degraded` / `partial`.** The allow-list loses its blast half; the reason is
  recorded and shown. The brief is still generated — the diff alone grounds it. AC-23.
- **No linked issue.** Normal and common; nothing is recorded as missing, because nothing was
  promised. Covered by AC-09's assembly rule rather than a criterion of its own: an absent
  optional input is not an event.
- **No Project Context documents.** Same — the block is simply absent, as
  `buildProjectContextBlocks` already does for reviews. AC-38 covers the enabled case.
- **PR with no changed files.** 422, no model call: there is nothing to ground on, and every
  reference the model produced would be dropped anyway. AC-24.
- **Model call fails or times out.** Error out, persist nothing, leave the previous brief
  readable. AC-25.
- **Two regenerations at once.** The unique key `(pr_id, state_key)` makes concurrent
  identical generations an upsert race with a harmless winner; concurrent *different* states
  produce two legitimate rows. No lock is taken — the rate limit is the cost bound. AC-08,
  AC-26.
- **The model returns a `risks[].kind` outside the six.** Normalised to `other` rather than
  rejecting the whole reply, because one bad enum value should not cost a paid call. AC-19.
- **The model returns zero risks and zero focus items.** A valid answer, stored as such;
  `risk_level` becomes `low`. AC-20, and `messages/en/brief.json` already has `noRisks`.
- **The stored brief is from a state whose files no longer exist.** It is served, marked
  stale, and a focus link to a vanished path hits AC-35's visible notice rather than a blank
  screen.
- **A brief exists but the PR row was deleted.** `pr_id` cascades, as it does today
  (`reviews.ts:120-125`); no criterion, it is a schema property.
- **`?file=` naming a path outside the PR.** Visible notice. AC-35.
- **Seeded rows on a machine that has also generated a real brief.** The real one wins the
  "most recent" read by `seq`; the seeded ones remain in the timeline. That is the honest
  outcome and needs no special case — the seed upserts on `(pr_id, state_key)` and its
  sentinel key never collides. AC-39, AC-27.

## Design analysis

Design source: `reference/devdigest-design/`, screen key **`pull-request-detail`**, entry
`src/features/pull-requests/pr-detail.jsx`, artboard **`pr-overview`**; mapped through
`BRIDGE.md`. Read: `BriefCard`, `IntentBlock`, `RiskPillRow`, `HistoryAccordion`,
`RISK_ICON`, `RISK_SEV`, and the `RISKS` fixture in `src/data/core-mock-data.jsx:42-46`.

**What the design does and does not cover.** `RiskPillRow` is a complete design for
`risks[]`: a wrapping row of toggle pills, an icon per `kind`, a border colour per `severity`,
and an expanded panel carrying `explanation` plus `file_refs` as `MonoLink`s. That is adopted
as given. The design has **no artboard at all** for `what`, `why`, `risk_level` or
`review_focus` — the four fields this feature exists to produce. Every screen decision about
those four below is therefore **derived**, and marked so.

### States missing from the mockup

- **Nothing generated yet.** The mock renders `RISKS` unconditionally. Derived: `EmptyState`
  with an icon, a title, a body and a CTA — the shape `IntentCard` already uses for the same
  situation, so the two cards on one tab do not disagree about what "not yet" looks like.
- **Generating.** Derived: the Regenerate button's own `loading` state, as
  `IntentCard`'s Re-derive does; no skeleton, because the previous brief stays on screen.
- **Stale.** Not a state the design has a concept of. Derived: a banner inside the card
  stating the brief describes an earlier state, with Regenerate as its action — the shape
  `BlastTab` uses for a degraded map.
- **Degraded inputs.** Derived: `missing_inputs` rendered as a short list under the prose,
  next to the claim it weakens — the placement `IntentCard` already uses for
  `missing_context`.
- **Dropped references.** Derived: a one-line note when `dropped_refs` is non-empty. The
  alternative is a card that quietly says less than the model did.
- **Trimmed input.** Derived: `trimmed` shown in the header's meta line beside tokens and
  cost, because a reader comparing two briefs needs to know one of them was asked less.
- **Zero risks / zero focus.** `messages/en/brief.json` already carries `noRisks`; a
  `noFocus` twin is derived from it.
- **Failed generation.** Derived: a toast plus the previous brief left intact — the product's
  existing behaviour for a failed mutation.

### Corner cases the design does not cover

- A pill row with fifteen risks. The design wraps and says nothing about a ceiling; derived:
  the model is capped at a stated maximum number of risks and focus rows in the prompt, and
  the cap is a constant in `modules/brief/constants.ts`.
- A `file_refs` entry 120 characters long. The mock's are short. Derived: middle-truncate the
  path in the `MonoLink`, keep the full value in `title`.
- `RISK_ICON[r.kind]` on an unknown kind is `undefined` and crashes the row. This is the
  concrete reason `Risk.kind` closes to six values with an `other` fallback (AC-19), rather
  than a taste argument about enums.
- A review-focus line number that no longer exists in the file. Handled by AC-35's rule at the
  file level; a line beyond the file simply focuses nothing and the file still opens.
- Two briefs at the same commit (regenerate at an unchanged head). The timeline shows both;
  `seq` orders them (AC-27), and the delta between them is usually empty — which is itself
  informative.

### How the involved modules talk

- `modules/brief` reads the intent through `container.intent.get()` — the read-only method,
  never `derive` — so a brief cannot trigger a second paid call.
- `modules/brief` reads the blast map through a newly brokered `container.blast`. Today
  `BlastService` is constructed inside `modules/blast/routes.ts` precisely because "nothing
  else consumes the blast map" (its own header comment). This feature is that second consumer,
  so the reason expires and the container is the answer — a direct
  `modules/brief` → `modules/blast` import is the cross-module rule that only *warns*
  (`server/.dependency-cruiser-onion.cjs:96`, root `INSIGHTS.md` 2026-08-22), so nothing would
  catch it.
- Project Context arrives through `container.projectContext.listForPrompt`, exactly as
  `modules/reviews/inputs.ts` takes it.
- Diff stats and the PR row arrive through `container.reviewRepo`; the brief's own repository
  owns only `pr_brief`.
- The linked issue arrives through `container.github()`, with the same short deadline
  discipline `INTENT_ISSUE_TIMEOUT_MS` established: an enrichment must never be able to hang
  the request that a human is waiting on.
- `container.tokenizer` is used outside `modules/repo-intel` for the first time. Its adapter
  doc comment scopes it to that module; the scope sentence is now wrong and the plan should
  correct it in place. The dependency itself is legitimate — it is brokered on the container
  and mockable through `ContainerOverrides.tokenizer`.
- On the client, `page.tsx` owns `?file` / `?line` and hands them down as props.
  `SmartDiffViewer` is unmounted while another tab is active, so an incoming focus cannot live
  in its local state: it arrives as a prop and is converted into a `focusToken` bump on
  arrival, reusing `FileCard`'s existing jump-and-highlight effect rather than a second
  mechanism.

### UX improvements proposed

Each of these is a **proposal**, not a requirement, and none of them has an `AC-NN`:

- *Proposal:* number the review-focus rows 1·2·3 rather than bulleting them, so "where do I
  start" has an answer and not a set.
- *Proposal:* put the model, token count and cost in the card header rather than a tooltip —
  the product already treats what a call cost as first-class (`CostBadge`, `PrIntentRecord`).
- *Proposal:* collapse the Why Timeline by default and badge it with its entry count, the way
  the design's `HistoryAccordion` badges its own.
- *Proposal:* when the newest and previous briefs differ in `risk_level`, say so on the
  collapsed timeline header ("risk rose medium → high"), because that is the one delta a
  reader would want without expanding.

## Non-functional requirements

| Limit | Value | Why this number |
|---|---|---|
| Model input budget | **8 000 tokens**, counted over the system message concatenated with the assembled user message, using `container.tokenizer.count` (js-tiktoken `cl100k_base`, `ceil(chars/4)` fallback) | The number the course brief names. Fixing the **unit** is the point: tokens, not characters; `cl100k_base`, not the provider's tokenizer; input only, output uncounted; system + user, not user alone. It is a **ceiling enforced before the call**: the assembler counts, trims and re-counts, and `completeStructured` is invoked only once the count is at or below 8 000 — so a breach is impossible rather than unlikely. If no rung of the ladder reaches it, the request fails 422 having spent nothing (AC-12) |
| Recorded token counts | both `input_tokens` (ours, `cl100k_base`) and `tokens_in` (the provider's) | They will differ — a different tokenizer counts a different number. Reporting one as the other would make the budget unfalsifiable |
| Trim ladder order | Project Context (whole documents, from the tail of the user's order) → linked-issue body (title and number kept) → blast-map rows (callers first, then symbols from the tail) → `pr_files` rows beyond the largest N by `additions+deletions`, replaced by a counted "… N more files" line → the minimal input | Whole units, never a body cut mid-sentence: `MAX_SKILLS_CHARS` and `MAX_PROJECT_CONTEXT_CHARS` give the reason — half a document still reads as a complete statement. The PR body and the intent are last because they are the only inputs that answer *why*, which is the feature's name |
| Briefs kept per pull request | **20**, oldest dropped | A safety valve, not a product decision about how much history is useful. Regeneration is an upsert on `(pr_id, state_key)`, so entries accumulate only when the inputs genuinely change; 20 is a number no real PR is expected to reach, and it exists so an automated loop cannot grow the table without bound |
| Risks and focus rows per brief | a stated cap in `modules/brief/constants.ts` for each | The card is a card. `EXPLAIN_MAX_SYMBOLS` and friends are the precedent: a cap stated in the prompt keeps the model from implying it enumerated everything |
| `POST` rate limit | `{ max: 10, timeWindow: '1 minute' }` | The same budget as `POST /pulls/:id/intent`, `POST /pulls/:id/blast/explain` and the conventions scan: a held-down button is a bill |
| `POST` request ceiling | a module-local timeout constant, honoured by the OpenAI and Anthropic adapters | The request is synchronous, so this is also how long a human stares at a spinner. Note it does **not** bind on OpenRouter, the default provider, which fixes its timeout at construction (90 s) — root `INSIGHTS.md`, 2026-08-06. Say so where the constant is, do not "fix" it here |
| `GET` cost | zero model calls, one query for the newest row plus one for the timeline | The claim AC-02 and AC-07 are read against |
| Model | a module-local `BRIEF_MODEL` constant, the same cheap structured-output model the other small features here default to | `FeatureModelId` is a closed five-value enum, and `modules/blast/constants.ts` already wrote out why a sixth entry is not worth two mirror edits, a duplicated client registry and a Settings row |

## Inputs and provenance

| Input | Where it comes from | When it is stale | If missing |
|---|---|---|---|
| Derived intent | `container.intent.get(ws, prId)` → `pr_intent` | When `pr_intent.head_sha` no longer equals the PR's head — the intent layer's own rule | Generate without it; record the reason in `missing_inputs`; never derive one (AC-22) |
| Blast map | `container.blast.forPull(ws, prId)` | Pinned to `indexed_sha`, which is the index's commit and not the PR's head | `status: degraded` is an answer, not an absence: allow-list loses its blast half, reason recorded (AC-23) |
| Diff stats | `pull_requests.additions/deletions/files_count`, `pr_files.path/additions/deletions` | `GET /pulls/:id` rewrites `pr_files` in a transaction, so stats are as fresh as the last detail load | Zero files → 422 (AC-24). `pr_files.patch` is never read |
| Linked issue | `extractLinkedIssue(pull.body, repoFullName)` then `container.github().getIssue()` | Whenever the issue is edited after generation — invisible to us, and covered by `state_key` only insofar as the title and body are part of the input | Not linked: nothing recorded. Linked but unreadable: recorded in `missing_inputs`, on the L03 precedent that an unreachable link is never silently replaced by invention |
| Project Context documents | `container.projectContext.listForPrompt(ws, repoId)`, enabled only, in the user's order | Whenever a document is edited, added, disabled or reordered — all of which move `state_key` | None enabled: no block, nothing recorded |
| PR title, branch, body | `pull_requests` | `body` is written only by `GET /pulls/:id`, so a PR nobody has opened has none | Recorded in `missing_inputs` with the same sentence the intent layer uses |
| The system prompt itself | `modules/brief/constants.ts` | Never, but it is part of the hashed input, so editing it invalidates every cached brief — deliberately | n/a |

## Untrusted inputs

Five author- or repository-controlled texts reach the model in this feature, and this module
does **not** go through `assemblePrompt`, so nothing wraps them for it:

- the PR title, branch name and body;
- the linked issue's title and body;
- the enabled Project Context documents;
- the persisted intent record's prose — model output that already passed the L03 guard, and
  therefore exactly the kind of laundered instruction that guard exists to stop travelling
  further;
- file paths, symbol names, endpoint strings and cron names from the index and from
  `pr_files`.

Each block is wrapped exactly once with `wrapUntrusted(label, content)` from
`@devdigest/reviewer-core`, by this module, at assembly time (AC-21). The root `INSIGHTS.md`
entry of 2026-08-29 is the trap to avoid inverted: `assemblePrompt` wraps `specs`, `repoMap`,
`callers` and `diff` for its callers, and this module has no `assemblePrompt`, so wrapping
here is required rather than duplicative — and it must happen exactly once, because
`wrapUntrusted` escapes any nested `</untrusted>` and a double wrap corrupts what is stored.

The system prompt carries its own injection guard, in the shape `INTENT_SYSTEM_PROMPT` and
`BLAST_EXPLAIN_SYSTEM_PROMPT` established: everything inside `<untrusted>` is data to be
described and never an instruction, in any language; the reply is written in English whatever
language the PR is in; and the grounding rule — name only the files, endpoints and jobs listed
in the input, never invent one. The grounding filter (AC-15–AC-18) is the enforcement; the
prompt sentence is only the request.

Nothing this feature produces is fed into another model's prompt: the brief renders to a human
and stops there. That is a deliberate boundary and it is why the guard here can be narrower
than a reviewing agent's — see `Non-goals`.

## Test plan

| Lane | Covers |
|---|---|
| `server` unit (`vitest run --exclude '**/*.it.test.ts'`) | the assembler's purity and byte-identity (AC-06), `state_key` derivation (AC-05), the trim ladder rung by rung (AC-11), the grounding filter on both halves of the allow-list and both drop rules (AC-15–AC-18), `kind` normalisation (AC-19), `risk_level` clamping (AC-20), the untrusted wrap count (AC-21), the timeline delta (AC-28) |
| `server` integration (`*.it.test.ts`, Docker) | the two routes end to end with `MockLLMProvider`: exactly one call on POST and zero on GET (AC-01, AC-02), 404 semantics (AC-03), `stale` (AC-04), the upsert (AC-08), the input actually handed to the provider being within budget (AC-10), 422 paths (AC-12, AC-24), `trimmed` and both token counts (AC-13, AC-14), degraded inputs (AC-22, AC-23), a failed call leaving the previous row intact (AC-25), the rate limit (AC-26), `seq` ordering across a single transaction (AC-27), the 20-entry cap (AC-29), seeded rows (AC-39) |
| `client` component (RTL) | the empty state and that it spends nothing before the click (AC-30), the stale banner (AC-31), block order (AC-32), one navigation per focus click (AC-33), the unknown-file notice (AC-35), `setTab` clearing the new params (AC-36), endpoint rows rendering unlinked (AC-37) |
| `e2e` (`10-pr-brief.flow.json`, hermetic) | the seeded card renders with its literals and its stale banner, a review-focus click lands on the file in the Files tab, and a reload keeps that focus (AC-07, AC-33, AC-34, AC-39) |
| shell / repo checks | a per-file `cmp -s` over exactly the `vendor/shared` files this work touches, plus `pnpm typecheck` in both packages (AC-40). **Never a whole-tree `diff -r`:** `adapters.ts`, `contracts/eval-ci.ts` and `contracts/productionize.ts` already differ before this work starts — recorded in `specs/L03-intent-layer.md` § Out of scope — so a tree-wide gate cannot tell our mirror edit from that pre-existing drift, which is the one thing it exists to do. `scripts/pr-self-review-checks.sh` (`check:contract-mirror`, `:161-168`) already applies exactly this per-file rule to the current diff and needs nothing built. A grep proving `modules/brief/**` never reads `pr_files.patch` (AC-09); a grep for the `llmCalls: 0` / `llmCalls: 1` literals in the routes (AC-01, AC-02) |

**Deliberately not covered by an automated test:** that a real model, given a real PR, writes
a *useful* `why`. No test can assert quality; what is asserted instead is that whatever it
writes is grounded (AC-15–AC-18), bounded (AC-10) and attributed (AC-14). Quality is checked
by the demo run against PR #482 described in the lesson's homework, and by the reviewer
reading the card.

## Risks

| Risk | How we would notice | What we do |
|---|---|---|
| `state_key` turns out to be too sensitive — a trivial input change invalidates a brief the reader would call current | Regenerate is pressed constantly on unchanged-looking PRs; `stale: true` on a PR nobody touched | It is a hash of the exact model input by design, and staleness is *reported*, never acted on automatically, so the cost of over-sensitivity is a banner rather than a bill. Narrowing what enters the hash is a later decision with evidence behind it |
| Brokering `BlastService` on `Container` makes it a dependency of everything | `container.blast` acquires callers that do not need a blast map | The container is the composition root and the alternative is a cross-module import that only *warns*. Reviewed at the plan stage, not defended forever |
| The trim ladder drops the input that mattered, and the brief is confidently thin | A brief whose `trimmed` is long and whose `why` says nothing | `trimmed` is on the record and on the card (AC-13). A brief that admits it was asked less is honest; one that does not is the failure |
| The model names a file that exists in the repository but not in this PR's diff or blast map | `dropped_refs` is routinely non-empty | The allow-list is deliberately narrow — the two halves in AC-15/AC-16 and nothing else. A wider list is a decision to make once, with the dropped references as its evidence |
| `Risk.kind` narrowing breaks a literal somewhere | `pnpm typecheck` red in one or both packages | Expected, and cheap: `Risk` has zero consumers today. The root `INSIGHTS.md` entry of 2026-08-29 is the discipline — sweep the *other* contract files for member names, not for the symbol, because shapes are re-declared inline in `vendor/shared` (root `CLAUDE.md` § Gotchas) |
| The seeded rows drift from what the assembler would produce, as `seed.ts` renames always do | The card shows a shape the code can no longer generate | The seeded rows are explicitly **stale** by construction (AC-39): their `state_key` is a sentinel that can never equal a SHA-256 hex, so the product never claims freshness it cannot prove, and the first real generation supersedes them without a conflict |
| `pr_brief`'s primary key change loses the existing table | Nothing today — it has zero rows and zero writers | Stated here so the migration review does not have to rediscover it. Generated with `pnpm db:generate`; `server/src/db/migrations/**` is never hand-edited |
| `OpenRouterProvider` ignores the per-request timeout, so the synchronous POST can hang for 90 s × retries | A spinner that outlives the stated constant | Documented at the constant (root `INSIGHTS.md`, 2026-08-06). Not fixed here — the fix belongs where the container builds the provider |

## Open questions

All answered; none carried. Recorded with their reasons so the decisions are auditable rather
than assumed.

1. **Where does a review-focus click land?** In-product. A new `?tab=diff&file=…&line=…`
   param owned by `page.tsx`, plumbed to `FileCard`'s existing focus mechanism. Not a
   `github.com` deep link — the homework's demo is "follow a link from review focus to a
   concrete file", and leaving the product to answer it is a weaker feature. AC-33–AC-36.
2. **Does the seeded demo PR get a brief?** Yes, two rows, on the L03 reasoning. The cache-key
   problem is resolved by changing the read semantics rather than the seed: `GET` returns the
   most recent brief *plus* whether it is stale, and `404` means only "never generated". The
   seeded rows carry a sentinel `state_key` and are therefore always stale — an explicit
   disposition, not an accident. AC-04, AC-39.
3. **May a review-focus item be an endpoint?** Yes; the assignment says "real files **or**
   endpoints". A discriminated `{ kind, ref, line, why }` keeps a file item navigable and an
   endpoint item honestly non-navigable. `risks[].file_refs` draws on the **file half only** —
   they render as `MonoLink`s beside file references in the design, and an endpoint concern
   belongs in the risk's `explanation` or in a focus row of its own. AC-15–AC-18, AC-37.
4. **Reuse or replace the existing `Risk` contract?** Reuse and narrow. `kind` closes to the
   design's five plus `other`, because `RISK_ICON[r.kind]` is an unguarded lookup that an open
   string turns into a crash, because `Risk` has zero consumers so the narrowing costs nothing
   but the mirror edit, and because `other` keeps a real risk that fits no icon expressible
   instead of mislabelled. The legacy `PrBrief` composite is left untouched and unused. AC-19,
   AC-40.
5. **How much history is kept?** Regeneration is an upsert on `(pr_id, state_key)`, so history
   grows by exactly one entry per genuinely different input state. 20 entries per PR is a
   safety valve, not a product decision. Ordering uses a monotonic `seq`, because
   `defaultNow()` is the transaction's timestamp (root `CLAUDE.md` § Gotchas) and the seed
   inserts several rows in one transaction — without `seq` the timeline's order would be
   planner order, and its deltas would be computed between the wrong pairs. AC-27, AC-29.
6. **The budget's unit, and what kind of promise it is.** 8 000 tokens, `cl100k_base`, system
   plus assembled user message, input only. It is enforced *before* the call and is therefore
   a guarantee: the call is issued only after the counted input is within it, and a ladder that
   bottoms out fails 422 having spent nothing. The provider's own `tokens_in` is recorded
   beside ours and is never substituted for it. AC-10, AC-12, AC-14.
7. **What "what changed in the intent" means in the Why Timeline.** A deterministic delta
   computed by code — `risk_level` transition, risk titles added and removed, review-focus
   references added and removed — and never a second model call. A timeline that costs money
   to read would not be read. AC-28.
8. **Does a grounding violation reject the brief?** No, and there is no reprompt: the homework
   specifies one structured call, and a second one to punish a bad reference doubles the cost
   of the failure. The reference is dropped, a focus row that *is* a reference dies with it, a
   risk that merely *has* references keeps its explanation, and everything dropped is recorded
   in `dropped_refs` and shown. AC-17, AC-18.
