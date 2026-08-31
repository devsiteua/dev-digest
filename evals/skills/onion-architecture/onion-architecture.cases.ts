import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

/**
 * `skillTask` runs content-only (no tools) and injects SKILL.md as the system prompt, so every
 * input the skill would normally gather itself has to be inlined here. Note what is NOT injected:
 * `skillContent()` reads SKILL.md plus a `references/` DIRECTORY, and this skill keeps its extra
 * pages as sibling FILES (`tooling.md`, `references.md`). Only SKILL.md reaches the model — which
 * is precisely what makes a single-rule edit to SKILL.md a controlled variable.
 *
 * Curation rule applied to every expectation below: it must be something a model WITHOUT this
 * skill would not produce (a DevDigest path, a numbered forbidden import, a sanctioned exception),
 * and it must be quotable — the judge passes a practice only on a verbatim quote.
 *
 * `di-container` marks the expectations tied to the DI-container requirement. That requirement is
 * the deliberate break of L06 experiment 2 (docs/l06-eval-experiments.md); everything else is a
 * control that must NOT move when it is removed.
 */

const DIFF_PROMPT = `You are reviewing a backend diff for DevDigest before it is merged. Judge it
against the layering rules only. For every problem, name the offending file and line, say which
ring the code is in and which rule it breaks, and state where the code belongs instead. If a
change is legal under a documented exception, say so explicitly rather than staying silent.

${fx("digest-export.diff")}`;

const PLACEMENT_PROMPT = `We are adding Slack notifications to DevDigest: when a review finishes,
post a message to a Slack channel. It needs an HTTP call to Slack's Web API with a bot token, and
\`ReviewService\` is what decides that a notification should go out.

Tell me exactly where each piece of this goes in \`server/\`, file by file, and how ReviewService
gets hold of the Slack client at runtime. Answer directly from the rules — do not ask for the repo.`;

// The negative prompt. The skill's own scope line excludes client/ and hands it to
// `frontend-architecture`; a skill that fires anyway invents ring violations for React components.
const OUT_OF_SCOPE_PROMPT = `In \`client/src/app/reviews/[id]/page.tsx\` I have a server component
that calls \`fetch()\` on our API and renders a \`<ReviewSummary>\` client component, which itself
imports a formatting helper from \`client/src/lib/format.ts\`. Review this arrangement.`;

export const cases: SkillCase[] = [
  {
    name: "reviews the planted diff: names the broken rule per file, and spares the sanctioned exception",
    kind: "quality",
    prompt: DIFF_PROMPT,
    // Cheap deterministic gate before the judge is paid for: an answer that never names the two
    // offending files is not a review of this diff.
    grounding: ["service.ts", "routes.ts"],
    practices: [
      "flags `import type { FastifyReply } from 'fastify'` and the `reply: FastifyReply` parameter added to reviews/service.ts as a violation, on the grounds that HTTP stops at routes.ts and only primitives or DTOs may be passed inward",
      "flags the inline drizzle-orm query (`app.container.db.select().from(reviews)`) added to reviews/routes.ts as a violation, and says it belongs in repository.ts rather than in a route handler",
      "di-container: flags `new ReviewRepository(this.container.db)` inside reviews/service.ts as a violation — the service must take the repository off `container` (the composition root, platform/container.ts + modules/index.ts) instead of constructing the concrete class itself",
      "does NOT flag the `import type { ReviewRow } from '../../db/rows.js'` added to reviews/helpers.ts — it explicitly identifies db/rows.ts as a sanctioned exception, deliberately outside any module so cross-cutting consumers can use row types",
      "assigns each named file to a ring by DevDigest's own vocabulary (Delivery / Application / Infrastructure, or rings 4 / 2 / 3) rather than describing the problem in generic layering prose",
    ],
    threshold: 0.6,
    maxTurns: 4,
  },
  {
    name: "places a new outbound integration: port, adapter, and how the service reaches it",
    kind: "quality",
    prompt: PLACEMENT_PROMPT,
    practices: [
      // Written in the skill's OWN path vocabulary. A first pass demanded a `server/` prefix and
      // "and nowhere else"; the model answered `src/vendor/shared/adapters.ts` and
      // `src/adapters/notifications/slack.ts` — both correct — and the judge failed them on the
      // literal prefix. A practice must be quotable from an answer the skill would call right.
      "puts the Slack client interface (the port) in `vendor/shared/adapters.ts`",
      "puts the concrete HTTP implementation under `src/adapters/<domain>/` (e.g. src/adapters/slack/ or src/adapters/notifications/)",
      "di-container: says ReviewService receives the Slack port from `container` — exposed on Container / the composition root — and must not construct the concrete Slack client itself",
      "keeps the answer proportional: it does not propose an extra forwarding layer, a repository per table, or an interface with a single implementation and no test seam",
    ],
    threshold: 0.6,
    maxTurns: 4,
  },
  {
    name: "negative — declines the client/ question instead of inventing an onion violation",
    kind: "quality",
    prompt: OUT_OF_SCOPE_PROMPT,
    // Threshold 0.5 gates on the second practice only, deliberately. Not-over-firing is what a
    // negative prompt exists to measure, and it held 2/2 at baseline. Declining out loud held only
    // 1/2 — the skill does say "For the client use `frontend-architecture`" (SKILL.md scope line),
    // and the model follows it about half the time. That is measured per-practice and reported,
    // but it is too noisy to gate a case that other experiments read a delta from.
    practices: [
      "does not assign the React components to an onion ring and does not report any ring / dependency-rule violation for them",
      "states that this rule set does not cover `client/**` and names `frontend-architecture` as the skill for the frontend",
    ],
    threshold: 0.5,
    maxTurns: 4,
  },
];
