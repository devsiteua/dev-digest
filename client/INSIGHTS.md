# Insights — client

Append-only, newest first within each section. Sections, entry format, and promotion rules:
see the root [`../INSIGHTS.md`](../INSIGHTS.md).

---

## What Works

### 2026-08-30 · A rule that lives in a callback the page hands down can only be seen by a PAGE test — the component under it renders whatever it is given

Trigger:  a criterion said switching tabs must clear `file`, `line` and `findingId` from the
          URL. The implementation was right; the only thing verifying it was a `grep` for a
          string in `page.tsx`.
Cause:    `setTab` is a closure inside the page. `PrDetailHeader` calls whatever `onSetTab` it
          is handed, so no test of the header can see which params that callback drops — and a
          grep cannot tell `setTab` from `openFinding`, cannot see the patch reach
          `router.replace`, and stays green if one navigation becomes two.
Takeaway: this repo already paid for the lesson once and wrote it down in the test itself:
          `src/app/skills/[id]/page.test.tsx` exists because "the SkillEditor renders whatever
          `tab` it is handed, so its tests passed while the PAGE quietly rejected two of the
          four keys". Copy that mock shape (mock `next/navigation`, `AppShell` and the hook
          modules, render inside the intl provider). The lever that makes a page test cheap is
          the tab you start on: `?tab=diff` needs six module mocks, `?tab=overview` also pulls
          the brief and intent hooks, and a `?trace=` in the URL silently mounts the run-trace
          drawer with three more.
          And prove it is not a grep in disguise — revert the rule, watch the test go red,
          restore.
Evidence: client/src/app/repos/[repoId]/pulls/[number]/page.test.tsx · client/src/app/skills/[id]/page.test.tsx
Status:   open

_None yet._

> Archived 2026-08-29 → [`../docs/insights-archive.md`](../docs/insights-archive.md), verbatim
> under this section: 2026-08-23, 2026-08-06 ×3. What stays here is `open`, plus any resolved
> entry an open one points at.

## What Doesn't Work

### 2026-08-29 · The L05 scaffold did not merely sit unused — it was WRONG, and three of its four pieces would have shipped a lie

Trigger:  building Project Context, expecting the dormant-scaffold pattern the root
          `INSIGHTS.md` 2026-08-02 entry describes. What was in the tree was worse than dormant.
Cause:    `useContextFiles` (`lib/hooks/core.ts:123`) called the real route
          `GET /repos/:repoId/context` and typed its answer `SpecFile[]` — the route returns
          `ProjectContextDoc[]`, so the hook was type-safe and factually wrong. `useReindexContext`
          (`:131`) called `/context/reindex`, an endpoint the approved spec rules out ever
          existing. `messages/en/context.json` was written in full around chunk counts, an
          `indexStatus`, a `mode` toggle and a `Preview | Edit` editor, and its empty state
          promised documents live "under `.devdigest/specs/`" — a filesystem path the spec's AC-03
          explicitly forbids from existing. Only the styles were harmless.
Takeaway: the 2026-08-02 rule ("grep for the feature's vocabulary before building") finds this
          scaffold but under-rates it. Extend the grep to `messages/<locale>/*.json` and read the
          copy for **promises about behaviour and about the filesystem**, not just for vocabulary
          — a message file is the only place in the tree where a removed feature can still make a
          factual claim to the user. And check a scaffold hook's declared type against the route
          it calls: a hook can be green under `tsc` and still describe an endpoint that never
          answered that shape.
Evidence: client/src/lib/hooks/core.ts:123,131 (both deleted); client/messages/en/context.json (rewritten)
Status:   resolved — deleted in the same commit that added their replacement (`7685882`)

### 2026-08-07 · "The model proposed N rules" is derived, not measured — and a re-scan inflates it by every previously-decided row

Trigger:  the first live scan's summary line read "read 12 files. The model proposed 22 rules:
          21 kept, 1 discarded", while the model had actually returned 20 (the prompt's own
          ceiling) and only 19 rows were new
Cause:    `scanSummary` computes `returned = result.candidates.length + result.discarded.length`.
          There is no proposed-count in the contract, so this is the only way to get one — but
          `candidates` is deliberately the screen's WHOLE state after a pass (new rows *plus*
          the accepted/rejected rows that survived, see `ConventionsService.extract` step f),
          not the rows this pass produced. Two `accepted` rules from an earlier scan were
          therefore counted as things the model had just proposed. On a first scan the number is
          exact, which is why it reads as correct; the error appears only on a re-scan, and it
          grows with every rule the user has decided on.
Takeaway: do not quote that line as a measurement of model output — subtract the non-`pending`
          rows first, or read `candidates.filter(c => c.status === 'pending').length`. Fixing it
          properly means the server returning a `proposed` count (it is the only layer that
          knows), not more arithmetic on the client. General shape: when a response field is a
          UNION of "what this call did" and "what was already there", any total derived from it
          is a different quantity than its label claims.
Evidence: src/app/repos/[repoId]/conventions/_components/ConventionsView/helpers.ts (scanSummary);
          messages/en/conventions.json (`page.scan.summary`)
Status:   open — the copy is wrong on a re-scan; not changed in L02

> Archived 2026-08-29 → [`../docs/insights-archive.md`](../docs/insights-archive.md), verbatim
> under this section: 2026-08-12, 2026-08-06 ×3. What stays here is `open`, plus any resolved
> entry an open one points at.

## Codebase Patterns

### 2026-08-30 · A design component adopted "as given" can carry an interaction hole the mock never had to answer for

Trigger:  building `RiskPillRow` from the design reference, which renders a risk's file
          references through `MonoLink`.
Cause:    in the prototype those references have no handler — the mock only has to look right.
          `MonoLink` renders a `<button>`, and every other use of it in this tree supplies an
          `href` or an `onClick`. Copying the design literally would have shipped three buttons
          that do nothing, which is worse than plain text: it is a control that promises a
          destination.
Takeaway: "adopted as given" settles how something LOOKS, never what it does. When taking a
          component from the design reference, check every primitive it uses for an implied
          interaction the mock was never obliged to wire, and decide that interaction
          deliberately — a real destination, or an element that is not a control.
Evidence: client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/_components/RiskPillRow/RiskPillRow.tsx
Status:   open

### 2026-08-05 · `CLAUDE.md` and `docs/component-anatomy.md` disagree on how many files a component folder needs

Trigger:  writing the `frontend-architecture` skill's acceptance criteria for "add a new
          component", and needing a decidable answer to "which files are mandatory?"
Cause:    the two documents state opposite rules. `CLAUDE.md:25-27` lists all six files
          (`<Name>.tsx · styles.ts · constants.ts · helpers.ts · index.ts · <Name>.test.tsx`)
          and says *"follow it rather than inventing a shorter one"*; `docs/component-anatomy.md:20`
          says *"Only `<Name>.tsx` and `index.ts` are mandatory; add the others as soon as the
          corresponding content appears"*. The tree follows the second: a dozen component folders
          ship without `styles.ts`, and `RunHistory/` has no `index.ts`. So the "12 folders violate
          the convention" reading of the tree is wrong — they satisfy the narrower rule, and the
          count is an artefact of comparing against the wider one.
Takeaway: follow `docs/component-anatomy.md` — it is the more specific document and the one
          `CLAUDE.md`'s own "Read when" section points to for this task. Read `CLAUDE.md`'s sentence
          as "do not invent a *different* shape", not "create six files regardless of content". The
          real violation to look for is a component with styles that keeps them inline anyway.
Evidence: client/CLAUDE.md:25-27; client/docs/component-anatomy.md:20;
          .claude/skills/frontend-architecture/references/devdigest-profile.md
Status:   open — one of the two sentences should be reworded; not done here to avoid changing a
          convention as a side effect of writing a skill

> Archived 2026-08-29 → [`../docs/insights-archive.md`](../docs/insights-archive.md), verbatim
> under this section: 2026-08-06 ×2, 2026-08-02. What stays here is `open`, plus any resolved
> entry an open one points at.

## Tool & Library Notes

### 2026-08-30 · `@devdigest/ui` answers `getByRole(…, { name })` for a Checkbox and refuses `getByLabelText` for every SelectInput — opposite answers, no clue at the call site

Trigger:  writing the Configure-step assertions for the Export Wizard. `getByRole("checkbox",
          { name: "pull_request: opened" })` resolved; `getByLabelText("Publish mode")` for the
          neighbouring select in the same form did not, and the query that works is
          `getByRole("combobox")`.
Cause:    `Checkbox` puts `role="checkbox"` on a `<button>` inside a bare `<label>`, and `<button>`
          is a labelable element, so the accessible name is computed from the wrapping label.
          `FormField` renders its `<label>` with no `htmlFor` and does not wrap its child, so
          nothing associates the two — the select has a visible label and no accessible one.
Takeaway: in this design system, reach a checkbox by its role AND name, and a select by
          `getByRole("combobox")` plus position or its options; `getByLabelText` is available only
          for the controls that carry an explicit `aria-label` (the repo input is one). There is no
          way to tell which case you are in from the JSX, so check the primitive before writing the
          query rather than after the test goes red.
Evidence: client/src/app/agents/[id]/_components/AgentEditor/_components/ExportWizard/ExportWizard.test.tsx:193
          · client/src/vendor/ui — `Checkbox`, `FormField`, `SelectInput`
Status:   open

### 2026-08-30 · `noUncheckedIndexedAccess` is on in `client/`, and `pnpm test` cannot see it

Trigger:  a new page test read `replace.mock.calls[0][0]`. Green under vitest, red under `tsc`.
Cause:    vitest transpiles without typechecking, and the client's `tsconfig` turns every
          indexed access into `T | undefined`. Mock-call assertions index twice, so they hit it
          constantly.
Takeaway: a client test is not finished until BOTH `pnpm test` and `pnpm typecheck` have run.
          Reach for a named helper that throws on the missing case rather than a `!` — the
          throw names what was expected when a mock was not called at all, which is the real
          failure hiding behind the index.
Evidence: client/tsconfig.json · client/src/app/repos/[repoId]/pulls/[number]/page.test.tsx
Status:   open

### 2026-08-22 · `@testing-library/user-event` is not installed — every RTL guide you will read assumes it is

Trigger:  writing the `test-writer` subagent's client rules and going to encode the library's
          own guidance, "prefer `userEvent` over `fireEvent`"
Cause:    `client/package.json:27-28` ships `@testing-library/jest-dom` and
          `@testing-library/react` and nothing else from that family. `user-event` is a
          separate package. It is the first thing every current RTL tutorial reaches for, so
          the gap is invisible until an import fails — and the existing tests do not reveal it,
          because they were written around `fireEvent` from the start.
Takeaway: in this package, interaction is driven with `fireEvent` from
          `@testing-library/react`. Accept the two things that costs — `fireEvent` skips the
          focus/keydown/input sequence a real interaction produces, and it will happily "click"
          a hidden or disabled element that `userEvent` would refuse — and assert around them
          rather than assuming a click implies interactability. If a test genuinely needs the
          full sequence, adding the dependency is a deliberate change with a lockfile in it,
          not a detail to slip into a test PR.
Evidence: client/package.json:27-28 (devDependencies); the existing suites' use of `fireEvent`,
          e.g. .../SkillsTab/SkillsTab.test.tsx
Status:   open — adding `@testing-library/user-event` is a reasonable call, just not one to
          make silently

> Archived 2026-08-29 → [`../docs/insights-archive.md`](../docs/insights-archive.md), verbatim
> under this section: 2026-08-28, 2026-08-23 ×2, 2026-08-12 ×2, 2026-08-06, 2026-08-02 ×2.
> What stays here is `open`, plus any resolved entry an open one points at.

## Recurring Errors & Fixes

_None yet._

## Session Notes

_None yet._

## Open Questions

_None yet._
