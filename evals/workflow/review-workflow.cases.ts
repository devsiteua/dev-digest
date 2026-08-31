import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 6 Claude sessions.
 *   - 2 × trace     → 1 session each                      = 2
 *   - 1 × contrast  → treatment + control                 = 2
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 *
 * REBUILT for L06 experiment 4. Every `expectFilesRead` in the previous version pointed at a file
 * that does not exist in this repository — `server/docs/api-contracts.md`,
 * `reviewer-core/docs/pipeline.md` and `reviewer-core/insights/gotchas.md` are all absent, so all
 * three trace cases asserted a read that could never happen. The targets below are taken from the
 * routing tables that are actually on disk (root `CLAUDE.md` § Read when, and
 * `reviewer-core/CLAUDE.md` § Read when) and each one has been checked to exist.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): root CLAUDE.md "Read when" routing + subagent dispatch, together ------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. Routing row: "You do not know the end-to-end review flow →
    // read `docs/architecture.md`".
    name: "review-flow task reads docs/architecture.md AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Я не знаю, як влаштований наскрізний review flow у цьому репо — спершу звірся з " +
      "настановами репозиторію і прочитай саме той документ, який вони для цього призначають. " +
      "Потім ОБОВʼЯЗКОВО запусти сабагента architecture-reviewer, щоб він оцінив мій план на " +
      "відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["docs/architecture.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): package-local CLAUDE.md routing, a different mechanism from the root --
  {
    kind: "trace",
    // `reviewer-core/CLAUDE.md` § Read when: "Changing prompt sections, their order, or adding a
    // slot → read `docs/prompt-contract.md`". Tests that a package's own CLAUDE.md routes, which
    // is not the same mechanism as the root file.
    name: "reviewer-core prompt task follows the package CLAUDE.md to prompt-contract.md",
    prompt:
      "Я збираюся додати нову секцію в промпт reviewer-core і змінити порядок наявних. Перш ніж " +
      "торкатися коду — звірся з настановами саме цього пакета щодо того, яку документацію треба " +
      "прочитати для змін у промпті, і прочитай саме ці документи.",
    expectFilesRead: ["reviewer-core/docs/prompt-contract.md"],
    maxTurns: 8,
  },

  // --- contrast (2 sessions): does CLAUDE.md actually change what gets read? --------------------
  // Restored to a real control/treatment pair. It had been downgraded to a trace because the old
  // control ran in an EMPTY temp directory, which conflated two different explanations for the
  // negative: "nothing routed me there" and "the file was not there at all" — and, worse, the
  // control could still reach the live repo by absolute path, making it the treatment under
  // another name. Both holes are now closed: `controlSeed` puts the target document in the
  // control's sandbox at the same relative path, so it is reachable and only the ROUTING RULE is
  // missing; and the runner fails loudly if the control reads anything under REPO_ROOT.
  {
    kind: "contrast",
    // Routing row: "You are deciding whether a rule belongs in an agent's prompt or in a skill →
    // read `docs/agent-prompts/README.md` § 'Skills / rules'".
    //
    // The probe was `docs/glossary.md` on the first series, and that pair is worth keeping in the
    // record because of what it showed: BOTH sides read it, 2/2. A file called `glossary.md` is the
    // obvious answer to a terminology question, so a model finds it by exploring and the routing
    // rule contributes nothing measurable. A probe whose target the question already gives away
    // cannot answer "does CLAUDE.md change what gets read" in EITHER direction.
    //
    // `docs/agent-prompts/README.md` is a routing rule with real information content: nothing about
    // "prompt or skill?" points at that path, and the section it names (`## Skills / rules`, at
    // README.md:66) is buried in a file about prompt assembly.
    name: "CLAUDE.md is what sends a prompt-vs-skill question to docs/agent-prompts/README.md",
    prompt:
      "Я не можу вирішити, куди покласти нове правило для рев'юера — у промпт самого агента чи " +
      "окремим скілом. Що на цю тему каже саме цей репозиторій? Дай відповідь за його документацією.",
    expectFileRead: "docs/agent-prompts/README.md",
    // The target plus decoys a curious model might open instead — including the two docs that ARE
    // guessable from the question. The control is a plausible project missing only the routing rule.
    controlSeed: [
      "docs/agent-prompts/README.md",
      "docs/architecture.md",
      "docs/glossary.md",
      "docs/skills-control-experiment.md",
      "README.md",
    ],
    tools: ["Read", "Grep", "Glob"],
    maxTurns: 6,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
