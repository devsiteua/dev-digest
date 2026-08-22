# Чотири нові субагенти: `test-writer`, `architecture-reviewer`, `plan-verifier`, `doc-writer`

Status: done
Owner: —
Packages touched: repo tooling (`.claude/agents/`, `docs/`) — жоден продуктовий пакет не змінюється

## Goal

Після цієї роботи в `.claude/agents/` живуть сім субагентів замість трьох: до
`planner` / `implementer` / `researcher` додаються чотири, кожен зі своєю смугою —
написання тестів, архітектурний рев'ю без права запису, звірка готового коду з планом
по пунктах, і документування реалізованих фіч. Кожен новий файл написаний рівно в тому
домашньому стилі, який уже несуть три наявні файли, і жоден із них не переписує правило,
що вже має власника в цьому репозиторії.

## Context

- Каталог і правила «як додавати агента» вже існують: `.claude/agents/README.md`
  (§ Catalog, § Permissions, § Artifacts in and out, § Adding an agent).
- Цей README сам називає дірку, яку закриває половина цього плану:
  § «What is deliberately not here» → *«No architecture or security review agent yet.
  `implementer` names both as out of scope in every report, so the gap is visible rather
  than silently filled by the agent that wrote the code.»*
- `.claude/agents/implementer.md` § Step 3 вже формулює межу для `architecture-reviewer`:
  *«`pnpm arch:check` is a mechanical guard, not an architecture review. It proves no layer
  was crossed. It says nothing about whether the design is right.»*
- Канонічна таблиця «шлях → скіли» одна на весь репозиторій: §3 «Route by path *and* by
  status» у `.claude/skills/pr-self-review/SKILL.md`. Root `INSIGHTS.md` (запис
  2026-08-21) прямо забороняє її копіювати в нові агенти — тільки посилання плюс дельти.
- Продуктова частина курсу вживає слово «Agent» в іншому значенні (`docs/glossary.md`
  § Review objects: *рядок у таблиці `agents`*), а L06 має продуктову фічу з назвою
  **Plan Verifier** (`specs/README.md`, рядок L06). Обидві колізії доводиться гасити
  текстом `description`, а не сподіванням.

## In scope

- Чотири нові файли: `.claude/agents/test-writer.md`, `.claude/agents/architecture-reviewer.md`,
  `.claude/agents/plan-verifier.md`, `.claude/agents/doc-writer.md`.
- Один новий документ `docs/README.md` — індекс `docs/`, на який `doc-writer` посилається
  замість того, щоб нести таблицю маршрутизації всередині себе.
- Оновлення `.claude/agents/README.md`: три таблиці (Catalog · Permissions · Artifacts),
  ASCII-схема потоку, § «What is deliberately not here», § Sources.

## Out of scope

- ~~**Створення самих файлів агентів у цій сесії.**~~ Знято прямою вказівкою користувача
  після затвердження плану — кроки 1–7 виконані в тій же сесії.
- **`security-reviewer` як субагент.** README свідомо тримає цю дірку відкритою;
  закривати її потрібно окремим рішенням, а не «за компанію».
- **Зміни в `.claude/settings.json` / `settings.local.json`** — ані `permissions.deny`
  для звуження `Bash`, ані правила `Agent(<name>)`. Це зміна конфігурації дозволів,
  яку санкціонує користувач, а не план.
- **Нові скіли.** Усі чотири агенти працюють на тому, що вже лежить у `.claude/skills/`
  (`ls -d .claude/skills/*/` — 15 директорій). Жодного `Skill`, якого немає на диску.
- **Зміни продуктових промптів** у `docs/agent-prompts/*.md` — вони прив'язані
  байт-у-байт до `server/src/db/seed-prompts.ts` тестом
  `server/test/agent-prompts-mirror.test.ts`; це продуктова зміна, не документування.
- **Ланцюжки агентів.** Правило README «No agent chains further» поширюється на всі
  чотири нові: жоден не має права спавнити наступного.
- Рефактор наявних трьох агентів. Їхній текст чіпаємо тільки там, де нова межа робить
  наявне речення неправдивим (перевірка — крок 6, і якщо таких речень немає, це нормальний
  результат).

## Acceptance criteria

- [ ] `ls .claude/agents/` показує `README.md` + 7 файлів агентів.
- [ ] Для кожного з чотирьох нових файлів `sed -n '2,5p' <file> | grep -o '^[a-z-]*:'`
      дає рівно `name: description: tools: model:` — той самий набір і той самий порядок,
      що в `planner.md`, `implementer.md`, `researcher.md`.
- [ ] Кожен новий файл містить рівно один рядок `Trigger terms:` всередині `description`,
      і в ньому є щонайменше три англомовні й три україномовні терміни.
- [ ] `grep -E '^tools:' .claude/agents/architecture-reviewer.md` не містить ані `Write`,
      ані `Edit`.
- [ ] `grep -E '^tools:' .claude/agents/plan-verifier.md` не містить ані `Write`, ані
      `Edit`, ані `Skill`.
- [ ] Жоден новий файл не містить власної таблиці «шлях → скіли»: `test-writer.md`
      посилається на `.claude/skills/pr-self-review/SKILL.md` §3 і перелічує лише дельти.
- [ ] Кожен беклапнутий шлях у чотирьох нових файлах існує на диску (команда — крок 7).
- [ ] Кожна назва скіла, згадана в нових файлах, є в `ls -d .claude/skills/*/`.
- [ ] `docs/README.md` існує, і його таблиця перелічує всі файли, які показує `ls docs`.
- [ ] `.claude/agents/README.md`: у § Catalog 7 рядків, у § Permissions 7 рядків, у
      § Artifacts 7 рядків; булет «No architecture or security review agent yet»
      переписаний так, що згадує лише security.
- [ ] Незмінним залишається: `planner` — єдиний, хто пише у `specs/`; `engineering-insights`
      — єдиний, хто пише в `INSIGHTS.md`; `implementer` — єдиний, хто змінює продуктовий код.
- [ ] Жоден файл поза `.claude/agents/**` і `docs/README.md` не змінений
      (`git status --short`).

## Test plan

Автоматизованого набору для `.claude/**` у репозиторії немає — `TESTING.md` § «Suite map»
перелічує п'ять сюїт, і всі п'ять прив'язані до пакетів. Тому перевірка цієї роботи —
механічні grep-перевірки з Acceptance criteria (крок 7) плюс один ручний smoke-тест
делегування на кожного агента: сказати сесії тригерну фразу і подивитися, кого викликав
роутер. `pnpm test` / `pnpm typecheck` / `pnpm arch:check` тут не застосовні й не
запускаються — жоден пакет не чіпається.

## Risks

- **Неправильне делегування.** Сім агентів із частково спільним словником — роутер може
  віддати «review my changes» архітектурному рев'юеру замість `/pr-self-review`.
  Як помітимо: smoke-тест на кроці 7; лікується формулюванням `description`, не тілом файлу.
- **`test-writer` править продуктовий код, щоб тест позеленів.** Як помітимо: у його
  таблиці `Changes` з'являється не-тестовий файл; захист — жорстке правило + обов'язковий
  рядок звіту.
- **`plan-verifier` з'їжджає в загальні поради** замість перевірки по пунктах. Як
  помітимо: кількість рядків таблиці ≠ кількість витягнутих пунктів; захист — лічильник
  у шапці звіту і дефолт `NOT VERIFIED`.
- **«Read-only» в `architecture-reviewer` — гарантія рівня інструкції, не інструмента.**
  `.claude/agents/README.md` § Permissions: *«`tools` says which tools, never with which
  arguments»*. Відсутність `Write`/`Edit` знімає найпростіший шлях, але `Bash` лишається
  здатним писати, і жоден наявний рантайм-механізм цього не помітить. Апґрейд, який це
  закриває, існує (`hooks: PreToolUse` у frontmatter агента) і свідомо відкладений —
  див. §2, «Чи не підриває `Bash` обіцянку».
- **`arch:check` виходить із кодом 0 на реальному порушенні** — `no-cross-module-import`
  має severity WARNING (`server/INSIGHTS.md`, 2026-08-06). Агент, який читає exit code
  замість виводу, звітує «чисто» на брудному дереві.
- **Дрейф документації.** Root `INSIGHTS.md` (2026-08-01) фіксує три твердження в
  committed-доках, які вже не відповідають коду. Захист — правило `doc-writer`: кожне
  твердження про механізм несе `file:line`.
- **`.claude/agents/README.md` стає другим джерелом правди.** Він сам це забороняє
  («This file is a map… do not let this table become a second source of truth»), тому
  крок 6 дописує рядки в таблиці, а не переказує правила.

## Open questions

- **Блокуючі:** немає.
- **Неблокуючі:**
  - Дві моделі `opus` (`architecture-reviewer`, `plan-verifier`) додають вартості. Ручка
    вниз до `sonnet` описана в кожній специфікації; рішення можна змінити без переписування
    процедури.
  - Чи варто згодом додати правила `Agent(<name>)` у `.claude/settings.json`, щоб
    формально закрити «хто кого може запускати» — поза цим планом (див. Out of scope).

## Constraints in force

| Constraint | Source | Що саме забороняє тут |
|---|---|---|
| `name` + `description` — єдині обов'язкові поля, але `tools` перелічуємо завжди; пропуск `tools` успадковує **всі** інструменти | `.claude/agents/README.md` § Permissions, § Adding an agent | залишити `tools` невказаним у read-only агентах — це мовчазний повний доступ |
| `tools` каже, ЯКІ інструменти, ніколи — з якими аргументами | `.claude/agents/README.md` § Permissions | обіцяти в прозі «Bash тут read-only» як технічну гарантію |
| Субагент бачить `CLAUDE.md`, але не історію розмови; назад повертається лише резюме | `.claude/agents/README.md` (вступ) | передавати вхід прозою замість шляху до файлу; повертати звіт, який не влазить у резюме |
| Канонічна таблиця «шлях → скіли» — §3 `pr-self-review/SKILL.md`; на неї посилаються, її не копіюють | root `INSIGHTS.md` 2026-08-21; `.claude/skills/pr-self-review/SKILL.md` §3 | нова таблиця маршрутизації всередині `test-writer.md` |
| Скіли шукають через `ls -d .claude/skills/*/`, **не** через `skills-lock.json` | `.claude/skills/pr-self-review/SKILL.md` §3; root `INSIGHTS.md` 2026-08-01 | назвати скіл, якого немає на диску (`architecture-patterns`, `github-workflow-automation` є в лоці, але не на диску) |
| Тест, що торкається БД, має суфікс `*.it.test.ts`; смуги розділені глобом | root `CLAUDE.md` § Conventions; `TESTING.md` § Conventions | покласти docker-залежний тест у unit-смугу |
| Сервісний тест, якому потрібен Docker, — це діагноз архітектури, а не привід перейменувати файл | `.claude/skills/onion-architecture/tooling.md` § «vitest — the layering's proof» | «полагодити» шар перейменуванням у `.it.test.ts` |
| Моки беруться з `server/src/adapters/mocks.ts`, руками не пишуться | `server/CLAUDE.md` § Map; `TESTING.md` § Conventions | власний `MockLLMProvider` у новому тесті |
| `reviewer-core` — zero I/O; ставиться через **npm**, не pnpm | root `CLAUDE.md`; `reviewer-core/CLAUDE.md` | `pnpm test` у `reviewer-core/` |
| `reviewer-core` `test` = `vitest run --passWithNoTests` | `reviewer-core/package.json:10` | вважати exit 0 доказом, що тести взагалі запускались |
| Контракт живе у двох копіях: `server/src/vendor/shared` і `client/src/vendor/shared` | root `CLAUDE.md` § Gotchas; `client/CLAUDE.md` § Gotchas | звітувати про правку контракту, не подивившись на дзеркало |
| `server/.dependency-cruiser-known-violations.json` — це список боргу; дописувати туди заборонено | root `INSIGHTS.md` 2026-08-05 | пропонувати «забейслайнити» нове порушення |
| `pnpm arch:check` — механічний сторож, не архітектурний рев'ю | `.claude/agents/implementer.md` § Step 3 | видавати зелений `arch:check` за висновок про дизайн |
| П'ять інваріантів огляду | `docs/architecture.md` § «The five invariants» | архітектурний висновок, який їх не перевіряв |
| Кожен маршрут починається з `getContext(container, req)`, кожен запит скоупиться `workspaceId` | `server/CLAUDE.md` § Conventions; `docs/architecture.md` § Tenancy | пропустити перевірку тенантності |
| Do-not-touch: `client/src/vendor/ui/**`, `server/src/db/migrations/**`, скіли з `skills-lock.json` | root і пакетні `CLAUDE.md` | будь-яка правка цих шляхів новим агентом |
| Кожен файл репозиторію — англійською | root `CLAUDE.md` § Conventions | українська всередині `.claude/agents/*.md` (цей план — українською, файли агентів — ні) |
| `INSIGHTS.md` пише лише `engineering-insights` у головній сесії | root `CLAUDE.md` § Session protocol; `.claude/agents/README.md` | будь-який із нових агентів дописує `INSIGHTS.md` |
| Спека живе в `specs/`, документ — у `docs/`, інсайт — в `INSIGHTS.md` | `specs/README.md` (вступ «Not to be confused with») | `doc-writer`, що пише в `specs/` |
| `docs/agent-prompts/*.md` дзеркалять `src/db/seed-prompts.ts` байт-у-байт | `docs/agent-prompts/README.md`; `server/test/agent-prompts-mirror.test.ts` | `doc-writer` редагує промпт-файл рев'юера |
| Продуктовий словник: **Agent** = рядок у `agents`; **Skill** = markdown-блок у промпті | `docs/glossary.md` § Review objects | документувати субагентів словом «agent» без уточнення «subagent» |

## Спостережений домашній стиль (з чого зліплені наявні три файли)

Це не пропозиція — це те, що буквально лежить у `planner.md`, `implementer.md`,
`researcher.md`. Нові чотири повторюють ту саму форму.

**1. Frontmatter — чотири поля, саме в цьому порядку** (перевірено
`sed -n '2,5p' .claude/agents/*.md`):

```yaml
---
name: <kebab-case, збігається з іменем файлу>
description: "<що робить>: <що читає / як працює>. <коли викликати; коли НЕ>. Trigger terms: <en>, …, <ua>, …"
tools: Read, Grep, Glob, Bash, …
model: opus | sonnet | inherit
---
```

`description` — **один рядок у подвійних лапках**, три речення й один хвіст
`Trigger terms:` зі змішаним англо-українським списком через кому. У `implementer`
хвіст ще й несе заперечення: *«it does not plan, does not review architecture or
security, does not commit, and does not open pull requests»*.

**2. Тіло — фіксований каркас:**

| Порядок | Секція | Як виглядає в наявних файлах |
|---|---|---|
| 1 | `# <Title>` | `# Planner`, `# Implementer`, `# Researcher` |
| 2 | Одне-два речення позиції | «You produce the plan. You never produce the code.» · «You investigate and report. You never change the codebase.» |
| 3 | `## Hard rules` | булети, кожен починається з **жирного** ключа: **One file.** · **No plan, no work.** · **Read-only.** |
| 4 | `## Step 0 — <питання-ворота>` | нумерований чек-лист + fenced-блок відмови (`## Clarification needed` / `## Cannot start`) з єдиною інструкцією «Emit only:» |
| 5 | `## Step 1 … ## Step N — <дія>` | заголовок через ` — `, всередині таблиці «що читати / чому» або нумеровані дії |
| 6 | Крок зі звітом | fenced ```` ```markdown ```` шаблон, і поруч речення «Sections stay even when empty — an empty X is a claim» |
| 7 | `## Style` | 3–4 булети про тон: «Answer first, then evidence», «No victory lap», «Do not pad» |

**3. Дрібніші конвенції, які тримають усі три файли:**

- жорсткі заборони формулюються через наслідок, а не через «не можна»:
  *«a planner that can edit code will edit code»*;
- дозволений `Bash` завжди супроводжується іменованим списком:
  `cat`, `sed -n`, `grep`, `rg`, `find`, `ls`, `git log`, `git show`, `git diff`;
- обов'язковий рядок про мову: *«English output, per the repo convention, whatever
  language the task was written in»*;
- посилання, ніколи не переказ: *«Read it and use it; do not restate it here and do not
  invent a second one»* (`planner.md` § Step 4);
- порожня секція звіту не видаляється — вона є твердженням.

**Промпт vs Skill.** `docs/agent-prompts/README.md` § «`## Skills / rules` — and what
belongs there instead of here» описує цей поділ для **продуктових** промптів
(`agents.system_prompt`), не для субагентів; аналог `Skill`-блока тут — інструмент
`Skill`. Переносне правило одне і воно там сформульоване прямо: *«If you find yourself
copying a paragraph between two agent prompts, it wanted to be a skill»*, і воно
збігається з root `INSIGHTS.md` 2026-08-21 («point, never copy»). Практична форма для
кожного з чотирьох:

| Агент | У файлі агента (роль, пріоритети, процедура, формат звіту) | Делегується скілу (каталоги правил, чек-листи) |
|---|---|---|
| `test-writer` | яку смугу тестів вибрати, що вважається доказом, шаблон звіту | `react-testing-library` (запити, `userEvent`, антипатерни), `onion-architecture` § vitest, §3 `pr-self-review` (маршрутизація) |
| `architecture-reviewer` | обсяг рев'ю, шкала severity, дисципліна доказів | `onion-architecture` (+ `tooling.md` § «Review checklist for a backend diff»), `frontend-architecture` (+ `references/devdigest-profile.md`) |
| `plan-verifier` | правило витягування пунктів і формат таблиці | **нічого** — інструмент `Skill` не виданий навмисно (див. специфікацію) |
| `doc-writer` | маршрутизація документів, дисципліна цитат, словник | `mermaid-diagram` (типи діаграм і шаблони) |

## Специфікації агентів

### 1. `test-writer`

**Призначення.** Написати тести як самостійний результат: покрити вже реалізовану фічу,
зафіксувати регресію під знайдений баг, добудувати відсутню смугу. Три пакети —
`client/` (vitest + jsdom + RTL), `server/` (unit і `*.it.test.ts`), `reviewer-core/`
(чистий двигун, npm).

**Коли викликати.** Тести — це і є замовлення. Приклади: «покрий `SkillsRail` тестами»,
«потрібен регресійний тест на те, що `?tab=` не збиває вкладку», «додай `.it.test.ts` на
скоупінг за `workspaceId`».

**Коли НЕ викликати.**
- Крок плану вже каже писати тест → це `implementer` (правило: тест усередині кроку плану
  належить виконавцю плану; `test-writer` — коли тест і є ціль).
- Полагодити падаючий тест на живому коді → це `implementer` (він змінює продуктовий код).
- Оцінити якість чужих тестів → це `/pr-self-review` і продуктовий
  `docs/agent-prompts/test-quality-reviewer.md`, не цей агент.
- Написати e2e-флоу → поза межами: `e2e/specs/*.flow.json` — це **дані**, не код
  (`e2e/CLAUDE.md`: «a flow is data, not code»), і авторинг описаний у
  `e2e/docs/flow-authoring.md`. Агент називає флоу під ризиком і зупиняється.

**Інструменти.** `Read, Edit, Write, Grep, Glob, Bash, Skill, TodoWrite`.
`Write`/`Edit` — бо тест це файл; `Bash` — бо тест без запуску не тест
(`pnpm exec vitest run …`); `Skill` — RTL і onion-правила вантажаться перед написанням;
`Grep`/`Glob` — знайти сусідній тест і повторити його форму. **Немає** `WebSearch`/`WebFetch`
— тією ж логікою, що в `implementer`: невідоме повертається питанням, а не пошуком.

**Модель.** `inherit` — тією ж підставою, що в `implementer` (README: «implementation
quality tracks the model you chose»). Тест — це код.

**Скіли.** Маршрутизація — §3 `pr-self-review/SKILL.md`, читати, не копіювати. Дельти
під написання тестів:
- `client/**/*.test.tsx` → `react-testing-library` (у таблиці вже є) + `frontend-architecture`
  тільки коли створюється новий файл (статус `A`/`R` у таблиці);
- `server/test/**` → `onion-architecture`, і обов'язково її `tooling.md`
  § «vitest — the layering's proof»;
- `reviewer-core/test/**` → `onion-architecture`, `typescript-expert`, `zod`;
- контрактні тести (`vendor/shared`) → `zod`;
- `design-reference` **не** застосовується (UI-поверхня не створюється);
- `security` і `engineering-insights` зняті — та сама дельта, що для `implementer`.

**Процедура.**
0. Ворота: чи названо (а) що саме покривати — файл/симптом/фіча, (б) який клас регресії
   тест має ловити. Немає — `## Cannot start`.
1. Завантажити ґрунт: root `INSIGHTS.md`, `<pkg>/INSIGHTS.md`, `<pkg>/CLAUDE.md`,
   `TESTING.md` § Conventions.
2. Вибрати смугу за `TESTING.md` § «Suite map» і зафіксувати вибір у звіті **до**
   написання: unit / `*.it.test.ts` / client component / reviewer-core.
3. Прочитати найближчий наявний тест і повторити його форму (розташування, іменування,
   хелпери з `server/test/helpers/`, `src/adapters/mocks.ts`).
4. Написати тест, потім запустити рівно його, потім — усю смугу пакета.
5. Звіт.

**Формат виводу** (секції лишаються навіть порожні):

```markdown
# Tests written: <що покрито>

**Package(s):** … · **Lane(s):** unit | it | client | reviewer-core

## Files
| File | New/Edited | Lane | Regression it catches |

## Commands
| Command | Result | Tests run | Notes |

## Not covered (by design)
## Production code untouched   ← або перелік того, що довелося б змінити, і чому я цього не зробив
## Insight candidates
```

**Жорсткі межі.**
- Змінює **тільки** тестові файли, фікстури й хелпери. Продуктовий файл, який довелося б
  правити, щоб тест позеленів, — це розбіжність: зупинитись і описати, не правити.
- Не послаблює й не видаляє наявні асерції, не міняє наявний тест, щоб він проходив.
- Docker-залежний тест — тільки `*.it.test.ts`; але сервісний тест, якому потрібен
  Docker, спершу репортується як архітектурна проблема (`onion-architecture/tooling.md`).
- Моки — з `server/src/adapters/mocks.ts`.
- `@testing-library/user-event` у `client/package.json` **немає** (є лише
  `@testing-library/react` і `jest-dom`). Канонічна настанова RTL — `userEvent` замість
  `fireEvent`; поки пакета немає, агент користується наявними засобами і **звітує пробіл**
  окремим рядком, а не тихо додає залежність.
- У `reviewer-core/` — `npm test`, і в звіті обов'язково кількість тестів: `--passWithNoTests`
  робить зелений exit code на нулі тестів (`reviewer-core/package.json:10`).
- e2e не запускає й не пише.
- Пастки, які вже коштували часу і які тест мусить враховувати: jsdom викидає будь-яку
  CSS-декларацію з `var()`, тому `toHaveStyle` сліпий до токенів; тест рівня екрана мусить
  стабити `components/app-shell`; DnD перевіряється справжнім `DragEvent` з `DataTransfer`
  (усі три — `client/INSIGHTS.md`).
- Не дописує `INSIGHTS.md`; віддає кандидатів.

**Trigger terms:** `write tests, add a test, cover with tests, regression test, unit test,
component test, integration test, it.test, RTL test, написати тести, покрити тестами,
додати тест, тест на регресію, юніт-тест, компонентний тест`.

---

### 2. `architecture-reviewer`

**Призначення.** Read-only перевірка архітектурних меж у `server/`, `reviewer-core/` і
`client/` з поверненням знахідок, кожна з яких стоїть на конкретному `file:line`. Це та
сама дірка, яку `implementer` називає в кожному звіті («Architecture review → the
architecture review agent»).

**Коли викликати.** «Чи не поїхали шари?», «сервіс тягне Drizzle?», «`arch:check` червоний
— що це означає?», рев'ю щойно доданого модуля/адаптера, перевірка перед тим, як
закріпити новий патерн.

**Коли НЕ викликати.**
- «Перевір мої зміни перед PR» → це скіл `/pr-self-review` (він і є ворота на
  `gh pr create`, і він маршрутизує весь діф по всіх скілах). Цей агент — одна вісь,
  глибоко, і воротами **не є**.
- «Куди покласти код, якого ще немає» → безпосередньо скіл `onion-architecture`
  (це його власний тригер) або `planner`.
- «Як працює X» → `researcher` (питання vs вердикт).
- Security — не тут (README тримає цю дірку відкритою свідомо).

**Інструменти.** `Read, Grep, Glob, Bash, Skill, TodoWrite`. Немає `Write`, немає `Edit`,
немає `WebSearch`/`WebFetch` (зовнішні факти — до `researcher`).

**Чи не підриває `Bash` обіцянку «no write access» — прямо.** Так, на рівні інструмента
підриває: `.claude/agents/README.md` § Permissions фіксує, що *«`tools` says which tools,
never with which arguments»*, тож `Bash` неможливо звузити всередині файлу агента. Три
варіанти й вибір:
- *не давати `Bash` узагалі* — тоді агент не може запустити `pnpm arch:check`, а
  `pr-self-review/SKILL.md` §2 прямо каже: **«A missing architecture guard is reported,
  never assumed clean»**. Механічна половина роботи зникає. Відхилено.
- *дати `Bash` без списку* — це той самий рівень, що в `planner`/`researcher`, але без
  їхнього іменованого переліку. Відхилено як менш суворе, ніж уже наявний прецедент.
- **Обрано:** дати `Bash` і звузити інструкцією до закритого списку —
  `cat`, `sed -n`, `grep`, `rg`, `find`, `ls`, `git log`, `git show`, `git diff`,
  `git status`, плюс рівно дві команди, що нічого не мутують:
  `pnpm arch:check` і `pnpm arch:check:all` (обидві — `depcruise … --output-type err`,
  `server/package.json:11-12`). Заборонено явно: будь-яке перенаправлення у файл, `sed -i`,
  `mkdir`, `pnpm db:*`, `docker compose`, `git add/commit/push`, `gh pr create`.
  Три опори, чому цього достатньо: (1) відсутність `Write`/`Edit` знімає найпростіший
  шлях; (2) `PreToolUse`-хук із `.claude/settings.json` діє й усередині субагента —
  README це стверджує на прикладі `scripts/pr-self-review-gate.sh`; (3) поагентне звуження
  **аргументів** усе ж існує — але не через `tools`: офіційна схема frontmatter субагента
  має поля `disallowedTools` і `hooks` (`PreToolUse`, скоуплений на одного агента), і саме
  хук — єдиний механізм, що бачить рядок команди. Цей план ним свідомо **не** користується:
  наявні три файли тримають рівно чотири поля (`name`, `description`, `tools`, `model`), а
  хук потребує окремого скрипта і власного тесту, тобто це окреме рішення, не «за компанію».
  Тому у файл агента йде чесне формулювання: заборона на аргументи — інструкційна, і
  апґрейд до `hooks:` описаний як відома ручка.

**Модель.** `opus` — тією ж підставою, що в `planner` («planning is where reasoning buys
the most»): агент не виробляє коду, лише судження. Ручка вниз до `sonnet` — якщо
використання виявиться частим і механічним.

**Скіли.** `onion-architecture` (для `server/**`, `reviewer-core/**`) плюс обов'язково
її `tooling.md` § «Review checklist for a backend diff» — дев'ять питань, які і є ядром
бекендного проходу; `frontend-architecture` плюс
`references/devdigest-profile.md` (для `client/**`); `zod` — коли в обсязі
`vendor/shared`. Жодного власного чек-листа замість цих.

**Процедура.**
0. Ворота: обсяг названо однозначно — діф (`git diff --name-status`), список шляхів, або
   пакет. «Подивись архітектуру» без обсягу → `## Cannot start`.
1. Спершу механіка: `pnpm arch:check` у `server/`. Читати **вивід**, не exit code:
   `no-cross-module-import` має severity WARNING, тому реальне порушення дає exit 0
   (`server/INSIGHTS.md` 2026-08-06). Окремо: `server/.dependency-cruiser-known-violations.json`
   — 16 заморожених порушень, які `--ignore-known` ховає; порушення зі списку йде у звіт
   як **pre-existing debt**, і пропонувати дописати туди нове — заборонено
   (root `INSIGHTS.md` 2026-08-05). Якщо сторож не запустився — це знахідка, а не тиша.
2. Завантажити скіли за зоною, потім прочитати файли в обсязі цілком.
3. Пройти осі: кільця й напрямок імпортів; `getContext` + скоуп за `workspaceId`
   (`docs/architecture.md` § Tenancy); залежності з `container`, не конкретним імпортом;
   п'ять інваріантів (`docs/architecture.md` § «The five invariants»); purity law
   `reviewer-core`; дзеркало `vendor/shared`; реєстрація модуля одним рядком у
   `modules/index.ts`; межа server/client компонентів для `client/`.
4. Кожна знахідка отримує `file:line`, який агент справді прочитав. Знахідка без такого
   рядка не публікується — це та сама дисципліна, що продукт застосовує до власних
   findings (`docs/architecture.md` інваріант 1).
5. Severity — рівно `CRITICAL | WARNING | SUGGESTION` (`docs/agent-prompts/README.md`:
   іншу шкалу не вводити), з антиінфляційним правилом: спекулятивне — максимум WARNING.

**Формат виводу.**

```markdown
# Architecture review: <обсяг>

**Scope:** <paths> · **Guard:** pnpm arch:check → <exit + що показав вивід>
**Verdict:** clean | issues found — <одне речення>

## Findings
| # | Severity | Rule / axis | Evidence (file:line) | What breaks |

## Pre-existing debt seen (not new)
## Checked and clean
| Axis | How I checked |

## Not checked
- Security → окремий рев'ю (агента немає) · Tests → `test-writer` · Pre-PR gate → `/pr-self-review`
```

**Жорсткі межі.** Не пропонує патч (можна вказати, куди зміна ляже — писати її не можна;
те саме правило, що в `researcher`). Не редагує baseline. Не тлумачить зелений
`arch:check` як архітектурний висновок. Секція «Checked and clean» обов'язкова —
без неї «знахідок немає» нічим не відрізняється від «не дивився».

**Trigger terms:** `architecture review, check layering, layer violation, boundary
violation, dependency rule, onion check, arch:check failed, does this respect the
architecture, архітектурний рев'ю, перевір шари, порушення меж, чи не поїхала
архітектура, залежності між шарами`.

---

### 3. `plan-verifier`

**Призначення.** Взяти план або спеку і готовий код і сказати **по кожному пункту
окремо**, чи він виконаний, з доказом. Не рев'ю якості, не поради — звірка.

> **Колізія назв, яку треба погасити в `description`:** L06 містить продуктову фічу
> «Plan Verifier» (`specs/README.md`, рядок L06). Перше речення `description` мусить
> починатися з «development-time subagent … not the L06 product feature», інакше роутер
> вихопить його на фразі «давай зробимо Plan Verifier».

**Коли викликати.** Після `implementer`: незалежна друга пара очей на його власний звіт
(README § Sources прямо цитує практику «plan as a file checked by a separate reviewer
subagent»). Або перед закриттям спеки — звірка з `Acceptance criteria`.

**Коли НЕ викликати.** Плану/спеки немає → нічого звіряти (звертатись до `planner`).
Потрібне рев'ю якості коду → `/pr-self-review` або `architecture-reviewer`. Потрібно
змінити план → `planner`; цей агент план **не редагує**.

**Інструменти.** `Read, Grep, Glob, Bash, TodoWrite`.
- Немає `Write`/`Edit` — верифікатор, що править код, перестає бути верифікатором.
- **Немає `Skill` — свідомо.** Завантажений якісний скіл перетворює перевірку по пунктах
  на загальний код-рев'ю, а це рівно той провал, який агент має виключати. Відсутність
  інструмента робить це властивістю процесу, а не обіцянкою в прозі — та сама логіка, що
  README застосовує до `planner` без `Edit`.
- `Bash` **потрібен і є ядром роботи**: пункт вважається виконаним, коли його `Verify:`
  реально запущено. Дозволено: читання/пошук (як у `researcher`) плюс
  `pnpm exec vitest run --exclude '**/*.it.test.ts'`, `pnpm exec vitest run .it.test`,
  `pnpm test`, `npm test`, `pnpm typecheck`, `pnpm arch:check`, `git diff/status/log/show`.
  Заборонено: `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:generate`, `docker compose`
  (особливо `down -v`), будь-який git-запис, `gh pr create`, e2e-прогони.

**Модель.** `opus` — режим відмови тут не брак знань, а лінь (згорнути тридцять пунктів
у три абзаци). Ручка вниз до `sonnet` можлива, бо шаблон жорсткий.

**Скіли.** Жодного — див. вище. Це не пропуск, це рішення, і воно записується у файл.

**Процедура.**
0. Ворота: (а) шлях до плану/спеки, (б) що вважається «готовим кодом» — гілка, діф або
   перелік файлів. Немає — `## Cannot start`.
1. Витягнути пункти **дослівно**, у фіксованому порядку джерел:
   кожен рядок `Acceptance criteria` · кожен булет `In scope` · кожен `Do:` і `Verify:` з
   `Implementation plan` · кожен рядок `Constraints in force` · кожен булет `Out of scope`
   (як **негативна** перевірка: чи не з'явилось те, чого не мало бути).
   Порахувати їх. `N` іде в шапку звіту.
2. Кожен пункт — окремий рядок `TodoWrite`. Без агрегації, без «схожі об'єднав».
3. Для кожного пункту: запустити його команду (якщо є) або знайти доказ у коді
   (`file:line`). Статус — рівно один із `MET | PARTIAL | NOT MET | NOT VERIFIED`.
   Дефолт — `NOT VERIFIED`; підвищується лише доказом.
4. Дві наскрізні перевірки: **scope creep** — файли з `git diff --name-only`, яких не
   просив жоден пункт; **out-of-scope violation** — код, що реалізує явно виключене.
5. Вердикт: `complete | incomplete | cannot verify` + одне речення.

**Формат виводу.** Таблиця має рівно `N` рядків; `N` продубльовано в шапці, щоб
розбіжність було видно без перерахунку. Рядки `MET` стискаються до одного рядка
(доказ у колонці, без прози) — це те, що тримає звіт у бюджеті резюме, про який
README попереджає («a subagent returns ~1–2k condensed tokens»); `PARTIAL` / `NOT MET` /
`NOT VERIFIED` отримують повний доказ.

```markdown
# Plan verification: <plan file>

**Items extracted:** N · **MET:** a · **PARTIAL:** b · **NOT MET:** c · **NOT VERIFIED:** d
**Verdict:** complete | incomplete | cannot verify — <одне речення>

## Item-by-item
| # | Item (verbatim) | Source section | Status | Evidence (file:line / command output) | Gap |

## Commands run
| Command | Result | Which items it settles |

## Scope creep
| File changed | No item asked for it |

## Out of scope — violated?
## Observed outside the plan (max 5, one line each)
```

**Жорсткі межі.**
- **Жоден рядок не може бути закритий загальною порадою.** Немає `file:line` або виводу
  команди → статус `NOT VERIFIED`, і крапка.
- Не об'єднує пункти, не переформульовує їх «зрозуміліше» — колонка `Item` дослівна.
- Не пропонує редизайн, не коментує стиль. Усе, що не прив'язане до пункту, вміщається
  в `Observed outside the plan` і обмежене п'ятьма рядками — щоб не з'їло звіт.
- Пропущена перевірка — це знахідка, не пропуск: немає Docker для `.it.test`, немає
  сервісу, команди не існує → `NOT VERIFIED` з причиною (правило `implementer` § Step 3:
  «A skipped check is a finding»).
- Не запускає e2e; називає флоу під ризиком.
- Нічого не пише на диск. Якщо звіт потрібен назавжди — його зберігає головна сесія.

**Trigger terms:** `verify the plan, check against the plan, plan compliance, did we do
everything, acceptance criteria check, point by point, звірити з планом, перевірити план,
чи все зроблено за планом, перевірка по пунктах, чи виконані критерії`.

---

### 4. `doc-writer`

**Призначення.** Перетворити реалізовану фічу, план, спеку чи діф на постійну
документацію — з діаграмами — і покласти її туди, де такий документ у цьому репозиторії
живе.

**Коли викликати.** «Задокументуй цей флоу», «онови `docs/architecture.md` під новий
модуль», «додай термін у глосарій», «намалюй діаграму послідовності для X».

**Коли НЕ викликати.**
- Записати урок, здобутий у сесії → `INSIGHTS.md` через скіл `engineering-insights`
  (root `CLAUDE.md` § Session protocol). Два автори в одному файлі — це конфлікт.
- Описати, **що має існувати** → `planner` і `specs/` (`specs/README.md`: спека
  короткоживуча, документ постійний).
- Змінити промпт продуктового рев'юера → це продуктова зміна з дзеркалом у
  `seed-prompts.ts` і тестом на байт-ідентичність.

**Інструменти.** `Read, Grep, Glob, Bash, Write, Edit, Skill, TodoWrite`.
`Write`/`Edit` — бо документ це файл, з обмеженням за розширенням і шляхом (нижче);
`Bash` read-only, тим самим списком, що в `planner` — щоб перевірити твердження в коді
перед тим, як його записати; `Skill` — `mermaid-diagram`.
Немає `WebSearch`/`WebFetch`: документується цей репозиторій, зовнішні факти — `researcher`.

**Модель.** `sonnet` — як `researcher`: робота полягає в перенесенні прочитаного, а не в
проєктних рішеннях; вартість помилки знижена вимогою цитувати `file:line`. Для документа
рівня `docs/architecture.md` головна сесія може підняти модель — це записується як ручка.

**Скіли.** `mermaid-diagram` — щоразу, коли в документі є діаграма (§3
`pr-self-review/SKILL.md` маршрутизує «docs with a ```mermaid fence» саме туди). Інших
скілів не вантажить.

**Куди що кладеться — за фактичною структурою `docs/` (перевірено `ls`, `find`).**

| Що за документ | Куди | Підстава |
|---|---|---|
| Як механізм працює і **чому так вирішили** | `docs/<topic>.md` | `specs/README.md`: «docs/ — how something works and *why* it was decided that way (permanent)» |
| Наскрізний потік огляду, інваріанти, тенантність | секції `docs/architecture.md` (`## Packages and how they reach each other`, `## The review sequence`, `## The five invariants`, `## Two background mechanisms, not one`, `## Tenancy`, `## Related reading`) | сам файл |
| Термін домену | нова стаття в одній із п'яти секцій `docs/glossary.md` (`Review objects`, `Pipeline terms`, `Repo intelligence`, `Platform`, `Course terms`) | сам файл |
| Конвенції промптів рев'юерів | тільки `docs/agent-prompts/README.md` | сам файл; п'ять сусідніх `*.md` — дзеркала seed-констант |
| Гайд з авторингу всередині пакета | `<pkg>/docs/`: `server/docs/module-anatomy.md`, `client/docs/component-anatomy.md`, `reviewer-core/docs/prompt-contract.md`, `e2e/docs/flow-authoring.md` | наявні файли |
| Що це за пакет і як його запустити | `<pkg>/README.md` | `specs/README.md` |
| Стратегія тестування і поділ смуг | `TESTING.md` | сам файл |
| Разове дослідження / експеримент | `docs/<name>.md` за зразком `docs/skills-control-experiment.md` | наявний прецедент |
| Урок, здобутий важко | `INSIGHTS.md` — **не цей агент** | root `CLAUDE.md` |
| Архів інсайтів | `docs/insights-archive.md` — веде `engineering-insights`, не цей агент | root `INSIGHTS.md` § Promotion rule |
| Вказівник на новий документ | один рядок у `Read when` відповідного `CLAUDE.md` | `specs/README.md` п.6 (симетричне правило: закриваючи спеку, вказівник прибирають) |

**Дірки в структурі — названі, не домислені.**
1. **`docs/README.md` не існує** (`ls docs/README.md` → *No such file*). Немає жодного
   committed-твердження, що саме живе в `docs/`; таблиця вище виведена з
   `specs/README.md` плюс фактичного набору файлів. Пропозиція, і вона в плані окремим
   кроком: створити `docs/README.md` як індекс (файл → на яке питання відповідає → хто
   веде), а у `doc-writer.md` **послатися** на нього замість того, щоб нести таблицю в
   собі — інакше з'явиться друга копія, яка розійдеться (root `INSIGHTS.md` 2026-08-21).
2. **Немає конвенції записів рішень (ADR).** Ані `docs/adr/`, ані `docs/decisions/`.
   Вигадувати її цей план не буде: рішення йде в розділ «чому» відповідного документа
   або в `Open questions` спеки. Якщо ADR колись знадобиться — це окреме рішення.

**Процедура.**
0. Ворота: (а) що документуємо — фіча, флоу, модуль, термін; (б) джерело — план, діф,
   код, чи все разом; (в) для кого документ. Немає — `## Cannot start`.
1. Прочитати джерело, потім **перевірити його в коді**: кожне твердження про механізм
   мусить мати `file:line`. Root `INSIGHTS.md` 2026-08-01 фіксує три committed-твердження,
   які вже неправдиві, з висновком «treat prose in READMEs as a hypothesis».
2. Визначити адресу за таблицею вище (після кроку 4 плану — за `docs/README.md`).
   **Оголосити маршрут до написання** — читач має мати змогу не погодитись, перш ніж
   текст з'явиться (та сама вимога, що в `pr-self-review` §3: «Print the routing decision
   *before* reviewing»).
3. Розширювати наявний документ, якщо він покриває тему; новий файл — лише коли
   жоден не покриває (симетрично правилу `planner`: «If an existing spec already covers
   the task, extend it — never open a rival file»).
4. Діаграми — тільки Mermaid, у стилі, який уже є в `docs/architecture.md`
   (`flowchart TB`, `sequenceDiagram`), через скіл `mermaid-diagram`. Діаграма ставиться
   лише там, де вона показує те, чого проза не показує.
5. Словник — рівно з `docs/glossary.md`. Синонім не вводиться; бракує терміна — стаття
   в глосарій, а не імпровізація в тексті. **Окрема пастка:** «Agent» у глосарії — це
   рядок у таблиці `agents` (продуктовий рев'юер). Документуючи `.claude/agents/**`,
   вживати «subagent».
6. Дописати вказівник у `Read when` відповідного `CLAUDE.md`, якщо створено новий документ.

**Формат виводу.**

```markdown
# Documented: <тема>

## Routing decision
| Document | Path | New/Extended | Why here (source of the rule) |

## Claims and their evidence
| Claim in the doc | file:line | Verified how |

## Diagrams
| Diagram | Type | What it shows that prose does not |

## Pointers updated
## Left undocumented (and why)
## Contradictions found between existing docs and code
```

**Жорсткі межі.**
- Пише **лише** `*.md` за адресами з таблиці. Не торкається вихідного коду, не пише в
  `specs/`, не пише в жоден `INSIGHTS.md`, не редагує `docs/agent-prompts/*.md` крім
  `README.md`, не чіпає `client/src/vendor/ui/**` і `server/src/db/migrations/**`.
- Твердження без `file:line` у документ не потрапляє. Невідоме лишається в
  «Left undocumented».
- Суперечність між наявним документом і кодом не «виправляється мовчки» — вона йде
  окремою секцією звіту (де діють правила `specs/README.md` і root `INSIGHTS.md`
  про те, хто це чинить).
- Англійська — вимога root `CLAUDE.md`, незалежно від мови задачі.

**Trigger terms:** `document this, write docs, update the docs, add a diagram, architecture
doc, glossary entry, README for, write documentation, задокументувати, написати
документацію, оновити доки, додати діаграму, опис фічі, діаграма послідовності`.

## Межі між сімома агентами

Місця, де відповідальності накладаються, і речення в `description`, яке цьому запобігає.

| Перетин | Хто виграє і чому | Що мусить сказати `description` |
|---|---|---|
| `implementer` теж запускає тести | тести всередині кроку плану — `implementer`; тест як замовлення — `test-writer` | у `test-writer`: «not for executing a plan step — that is `implementer`» |
| `implementer` теж запускає `arch:check` | `arch:check` — механіка (`implementer.md` § Step 3); судження про дизайн — `architecture-reviewer` | у `architecture-reviewer`: «`pnpm arch:check` is where it starts, not what it returns» |
| `/pr-self-review` теж дивиться архітектуру | скіл — ворота на весь діф перед PR; агент — одна вісь, глибоко, і воротами не є | у `architecture-reviewer`: явно **не** брати «review my changes / before PR / can I merge» |
| скіл `onion-architecture` теж відповідає «куди покласти» | код, якого ще немає → скіл або `planner`; код, який уже є → агент | у `architecture-reviewer`: «reviews code that exists» |
| `researcher` теж вивчає репозиторій | питання «як воно працює» → `researcher`; питання «чи правильно» → `architecture-reviewer`; питання «чи зроблено за планом» → `plan-verifier` | у `plan-verifier` і `architecture-reviewer`: «returns a verdict, not an explanation» |
| `planner` теж читає спеки | `planner` пише план; `plan-verifier` звіряє з ним і **не редагує** його | у `plan-verifier`: «does not amend the plan — gaps go back to `planner`» |
| `implementer` сам звітує про верифікацію | самозвіт лишається; `plan-verifier` — незалежний другий прохід | у `plan-verifier`: «independent second pass over `implementer`'s result» |
| `engineering-insights` теж пише markdown | `INSIGHTS.md` — тільки скіл, у головній сесії | у `doc-writer`: «never writes any `INSIGHTS.md`» |
| L06 «Plan Verifier» — продуктова фіча | різні речі; агент — інструмент розробки | у `plan-verifier`: перше речення відмежовує від L06 |
| «Agent» у глосарії — рядок у `agents` | різні речі | у `doc-writer`: «say *subagent* when documenting `.claude/agents/**`» |

## Implementation plan

### Step 1 — `architecture-reviewer.md`   ·   package: repo (`.claude/agents/`)
Files:    `.claude/agents/architecture-reviewer.md` (new)
Skills:   — (пишеться markdown; вантажити скіли не потрібно)
Do:       Написати файл за специфікацією §2 у домашньому стилі з «Спостережений домашній
          стиль». Першим іде саме він: найменший радіус ураження (немає `Write`/`Edit`),
          і він закриває дірку, яку `.claude/agents/README.md` уже назвав. Секція про
          `Bash` мусить містити всі три опори, включно з чесним «per-agent argument
          narrowing does not exist».
Verify:   `sed -n '2,5p' .claude/agents/architecture-reviewer.md | grep -o '^[a-z-]*:' | tr '\n' ' '`
          → `name: description: tools: model: ` ;
          `grep -E '^tools:' .claude/agents/architecture-reviewer.md | grep -Eq '(Write|Edit)' && echo FAIL || echo OK`
Depends:  none

### Step 2 — `plan-verifier.md`   ·   package: repo (`.claude/agents/`)
Files:    `.claude/agents/plan-verifier.md` (new)
Skills:   —
Do:       Написати файл за §3. Обов'язково: відмежування від продуктової фічі L06 у
          першому реченні `description`; відсутність `Skill` пояснена як рішення;
          лічильник `Items extracted: N` у шапці звіту; дефолтний статус `NOT VERIFIED`;
          `Observed outside the plan` обмежений п'ятьма рядками.
Verify:   `grep -E '^tools:' .claude/agents/plan-verifier.md | grep -Eq '(Write|Edit|Skill)' && echo FAIL || echo OK` ;
          `grep -c 'NOT VERIFIED' .claude/agents/plan-verifier.md` → ≥ 3 ;
          `grep -qi 'L06' .claude/agents/plan-verifier.md && echo OK`
Depends:  none

### Step 3 — `test-writer.md`   ·   package: repo (`.claude/agents/`)
Files:    `.claude/agents/test-writer.md` (new)
Skills:   —
Do:       Написати файл за §1. Маршрутизація — **посилання** на
          `.claude/skills/pr-self-review/SKILL.md` §3 плюс перелік дельт; жодної власної
          таблиці «шлях → скіли». Смуги, команди й межі — дослівно з root `CLAUDE.md`
          § Commands і `TESTING.md` § Running locally.
Verify:   `grep -q 'pr-self-review/SKILL.md' .claude/agents/test-writer.md && echo OK` ;
          `grep -c '| \`server/src' .claude/agents/test-writer.md` → `0` (немає власної
          таблиці маршрутизації) ;
          `for s in $(grep -oE '\`[a-z-]+\`' .claude/agents/test-writer.md | tr -d '\`' | sort -u); do [ -d ".claude/skills/$s" ] && echo "skill ok: $s"; done`
Depends:  none

### Step 4 — `docs/README.md` як індекс `docs/`   ·   package: repo (`docs/`)
Files:    `docs/README.md` (new)
Skills:   —
Do:       Створити індекс: одна таблиця «файл → на яке питання відповідає → хто його
          веде», плюс три рядки різниці `docs/` vs `specs/` vs `INSIGHTS.md`, взяті
          посиланням із `specs/README.md`, і явна нотатка, що конвенції ADR у репозиторії
          немає. Це передумова кроку 5: без нього `doc-writer` змушений нести таблицю
          маршрутизації в собі й породити другу копію.
Verify:   `ls docs | sort > /dev/null; for f in $(ls docs); do grep -q "$f" docs/README.md || echo "MISSING FROM INDEX: $f"; done`
          → порожній вивід
Depends:  none

### Step 5 — `doc-writer.md`   ·   package: repo (`.claude/agents/`)
Files:    `.claude/agents/doc-writer.md` (new)
Skills:   —
Do:       Написати файл за §4, з маршрутизацією **через посилання на `docs/README.md`** і
          лише тими рядками, яких індекс не покриває (пакетні `<pkg>/docs/`, `TESTING.md`,
          заборона на `docs/agent-prompts/*.md` крім README, вказівники в `Read when`).
Verify:   `grep -q 'docs/README.md' .claude/agents/doc-writer.md && echo OK` ;
          `grep -q 'seed-prompts' .claude/agents/doc-writer.md && echo OK` ;
          `grep -qi 'subagent' .claude/agents/doc-writer.md && echo OK`
Depends:  Step 4

### Step 6 — оновити `.claude/agents/README.md`   ·   package: repo (`.claude/agents/`)
Files:    `.claude/agents/README.md` (edit)
Skills:   —
Do:       Дописати чотири рядки в § Catalog, § Permissions (з колонкою «Deliberately
          lacks» і причиною), § Artifacts in and out. Оновити ASCII-схему потоку: гілка
          «architecture review» більше не «not this agent's job», а вказує на агента.
          Переписати булет § «What is deliberately not here» так, щоб він стосувався лише
          security. Дописати в § Sources внутрішній рядок про `docs/README.md`. Нічого
          з правил самих агентів сюди не переносити — файл лишається мапою.
Verify:   `awk '/^\| Agent \| Responsibility/,/^$/' .claude/agents/README.md | grep -c '^|'`
          → `9` (заголовок + роздільник + 7 агентів) ;
          `grep -n 'No architecture or security review agent yet' .claude/agents/README.md`
          → порожньо
Depends:  Steps 1, 2, 3, 5

### Step 7 — верифікація самого плану   ·   package: repo
Files:    — (нічого не змінюється)
Skills:   —
Do:       Прогнати механічні перевірки по всіх чотирьох нових файлах і зробити один
          smoke-тест делегування на агента.
Verify:   (а) frontmatter:
          `for f in .claude/agents/{test-writer,architecture-reviewer,plan-verifier,doc-writer}.md; do echo -n "$f: "; sed -n '2,5p' "$f" | grep -o '^[a-z-]*:' | tr '\n' ' '; echo; done`
          → у кожному рядку `name: description: tools: model:` ;
          (б) існування шляхів (плейсхолдери шаблонів відсіюються `grep -v 'path/'`):
          `for f in .claude/agents/{test-writer,architecture-reviewer,plan-verifier,doc-writer}.md; do grep -oE '\`[A-Za-z0-9_./-]+\.(md|ts|tsx|json|sh|cjs)\`' "$f" | tr -d '\`' | grep -v '^path/' | sort -u | while read p; do [ -e "$p" ] || echo "MISSING $f -> $p"; done; done`
          → порожній вивід ;
          (в) тригерні терміни двома мовами:
          `for f in …; do echo -n "$f "; grep -c 'Trigger terms:' "$f"; grep -o '[а-яіїєґА-ЯІЇЄҐ][а-яіїєґ ]\{3,\}' "$f" | head -3; done`
          → рівно 1 і три кириличні терміни ;
          (г) `git status --short` → змінені лише `.claude/agents/*` і `docs/README.md` ;
          (д) вручну: чотири фрази — «покрий цей компонент тестами», «перевір, чи не
          поїхали шари в новому модулі», «звір готовий код із планом по пунктах»,
          «задокументуй цей флоу з діаграмою» — і кожна має піти правильному агенту;
          контрольна фраза «review my changes before PR» має піти в `/pr-self-review`,
          а не в `architecture-reviewer`.
Depends:  Steps 1–6

## Handoff

Plan file:      `specs/four-new-subagents.md`
Entry point:    Step 1
Verification:   продуктових пакетів план не торкається — `pnpm test` / `pnpm typecheck` /
                `pnpm arch:check` не застосовні. Фінальна перевірка — крок 7 цілком
                (пункти а–д), плюс `git status --short` як доказ, що нічого поза
                `.claude/agents/**` і `docs/README.md` не змінилось.
Deviation policy: зупинитись на кроці, описати розбіжність, доробити незалежні кроки.
                  Кроки 1–4 незалежні між собою; крок 5 залежить від 4, крок 6 — від
                  1, 2, 3, 5. Не перепланувати.

## Sources

Дві незалежні розвідки, запущені паралельно до цього плану. Усе, що нижче, — зовнішні
джерела; репозиторійні підстави лишаються в § Constraints in force.

### A. Механіка субагентів Claude Code (перевірено проти встановленої версії 2.1.239)

| Факт, що вплинув на план | Джерело |
|---|---|
| Frontmatter підтримує 14 полів; обов'язкові лише `name` і `description`. Пропущений `tools` успадковує **всі** інструменти | https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields |
| `tools` у документації — завжди comma-separated рядок; YAML-списку в жодному офіційному прикладі субагента немає (на відміну від `allowed-tools` у Skill) | там само; https://code.claude.com/docs/en/skills |
| `disallowedTools` (денилист) і `hooks` (`PreToolUse`, скоуплений на одного агента) — офіційні поля субагента. Це і є єдиний поагентний спосіб побачити аргументи команди | там само, § Define hooks for subagents |
| Офіційний приклад read-only агента (`safe-researcher`, `code-reviewer`) видає `Read, Grep, Glob, Bash` і називає це read-only — тобто той самий компроміс, що обрано тут | там само |
| `Edit`/`Read` deny-правила покривають файлові команди, які Claude Code розпізнає в Bash, і редиректи — але **не** довільні підпроцеси (Python/Node-скрипт, `sed -i`) | https://code.claude.com/docs/en/permissions § Redirections |
| `model` за замовчуванням = `inherit`; порядок розв'язання: env → параметр виклику → frontmatter → головна сесія | https://code.claude.com/docs/en/sub-agents#choose-a-model |
| Субагент бачить системний промпт, ієрархію `CLAUDE.md`, git-статус і преload-скіли — але **не** історію розмови; назад повертається лише резюме. Звідси вимога передавати шлях до файлу, а не прозу | там само, § What loads at startup |
| Скіл можна викликати в рантаймі, поки `Skill` лишається в `tools`; `skills:` лише преload. Прибрати `Skill` — єдиний спосіб заборонити скіли повністю (підстава рішення в §3) | там само; https://code.claude.com/docs/en/skills |
| «use proactively» — формулювання самої Anthropic для автоделегування; «MUST BE USED» — поширена, але **не** документована community-конвенція | https://code.claude.com/docs/en/sub-agents § Understand automatic delegation |
| Рекомендована структура промпту (роль → нумероване «When invoked» → чек-лист → формат виводу) і єдиний названий антипатерн — «design focused subagents» | там само, § Example subagents |

### B. Інженерні практики за ролями

**`test-writer`**

| Практика | Джерело |
|---|---|
| Пріоритет запитів RTL (`getByRole` → … → `getByTestId` останнім) і принцип «тест має нагадувати те, як користувач взаємодіє» | https://testing-library.com/docs/queries/about/ |
| `userEvent` замість `fireEvent` (перевірки видимості/інтерактивності) | https://testing-library.com/docs/user-event/intro/ |
| Каталог антипатернів: `container.querySelector`, ручний `cleanup`, `act()` навколо `render`, `query*` для перевірки наявності, кілька асерцій усередині `waitFor` | https://kentcdodds.com/blog/common-mistakes-with-react-testing-library |
| Testing Trophy: інтеграційний рівень найбільший для UI; важке мокання «знищує впевненість» | https://kentcdodds.com/blog/write-tests |
| Test Pyramid і антипатерн «ice-cream cone» (крихкі, повільні, недетерміновані UI-тести) | https://martinfowler.com/bliki/TestPyramid.html |
| `fastify.inject()` як дефолт (піднімає всі плагіни без сокета); `build()`-фабрика як шов для тест-даблів | https://fastify.dev/docs/latest/Guides/Testing/ |
| Arrange-Act-Assert; «одна асерція» — це одна **поведінкова тема**, а не буквально один `expect` | https://xp123.com/3a-arrange-act-assert/ |

**`architecture-reviewer`**

| Практика | Джерело |
|---|---|
| Fitness functions: об'єктивна, автоматизована, бінарна перевірка однієї названої архітектурної характеристики | Ford/Parsons/Kua, *Building Evolutionary Architectures*, ch. 2 — https://www.oreilly.com/library/view/building-evolutionary-architectures/9781491986356/ch02.html |
| Форма доказу порушення: **ім'я правила + точний source → target**, а не переказ | https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-tutorial.md |
| Той самий підхід на рівні лінта (`boundaries/elements` + `policies`) | https://github.com/javierbrea/eslint-plugin-boundaries |
| Ports-and-adapters: усі стрілки залежностей дивляться всередину, ядро не залежить ні від чого зовнішнього (підстава для purity law `reviewer-core`) | https://alistair.cockburn.us/hexagonal-architecture |

**`plan-verifier`**

| Практика | Джерело |
|---|---|
| Requirements Traceability Matrix: рядок = вимога + артефакт, що її реалізує + тест, що її перевіряє + статус + доказ | https://www.jamasoftware.com/requirements-management-guide/requirements-traceability/traceability-matrix/ |
| Verification («чи будуємо продукт правильно» — звірка зі специфікацією) vs validation («чи той продукт»). Цей агент робить **verification** | https://en.wikipedia.org/wiki/Software_verification_and_validation (ISTQB-термінологія) |
| Вердикти тесту за ISO/IEC/IEEE 29119 — `pass / fail / inconclusive`. Наша чотирьохрівнева шкала `MET / PARTIAL / NOT MET / NOT VERIFIED` — **домашнє розширення**, а не цитата стандарту: `NOT VERIFIED` покриває випадок, коли план сам занадто розмитий, щоб його перевірити | https://en.wikipedia.org/wiki/ISO/IEC_29119 |
| Definition of Done (стабільний, для всього інкремента) vs Acceptance Criteria (per-item) — два окремі проходи, дві категорії знахідок | https://www.scrum.org/resources/blog/what-difference-between-definition-done-and-acceptance-criteria |
| Розділення вимірів рев'ю і префікс «Nit:» для незобов'язальних зауважень — контроль проти підміни пунктової звірки загальними порадами | https://google.github.io/eng-practices/review/reviewer/looking-for.html |

**`doc-writer`**

| Практика | Джерело |
|---|---|
| Diátaxis: tutorial / how-to / reference / explanation — чотири типи за двома осями. `docs/architecture.md` і `docs/glossary.md` цього репозиторію — *explanation*; `specs/` ближче до *how-to*/*reference* | https://diataxis.fr/ |
| C4: Context → Container → Component → Code. Дефолт для документа — Context + Container; Code-рівень не підтримувати вручну | https://c4model.com/ і https://c4model.com/faq |
| ADR за Nygard: Title / Status (включно з `superseded`) / Context / Decision / Consequences; рішення **не редагують, а заміщують**. Формат зафіксовано як довідку — конвенції ADR у репозиторії немає і план її не вводить | https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions |
| Сучасний підтримуваний markdown-шаблон того ж формату | https://adr.github.io/madr/ |
| Docs-as-code: документ живе в репозиторії і їде тим самим PR. Застереження, яке лягло в правило «claim без `file:line` не пишеться»: співрозташування **не** гарантує актуальності | https://www.writethedocs.org/guide/docs-as-code/ |

### Чого джерела не підтверджують (і що з цього випливає)

- **Немає офіційного прикладу YAML-списку для `tools:` у субагенті.** План лишається на
  comma-separated формі — тій самій, що в трьох наявних файлах.
- **Anthropic ніде не називає антипатерном «агент, який і планує, і виконує»** — навпаки,
  її власний приклад `debugger` робить і те, і те. Поділ `planner`/`implementer` у цьому
  репозиторії — рішення репозиторію, а не вимога документації. Нові чотири агенти
  успадковують саме репозиторійне рішення.
- **Немає канонічного джерела для порогу «коли діаграма виправдана».** Правило
  `doc-writer` («діаграма лише там, де показує те, чого проза не показує») — домашнє.
- **`«MUST BE USED»` не має виміряного ефекту** на точність делегування. Тому
  `description` нових агентів пишуться в стилі наявних трьох, а розведення відповідальностей
  тримається на реченнях «коли НЕ», а не на капслоку.
