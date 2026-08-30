import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

/**
 * Shared by the strict (`architecture-reviewer`) and relaxed (`architecture-reviewer-lite`)
 * variants, so both are graded on the exact same task. The only thing that may move between the
 * two series is whether the agent NAMES the documented rule; everything else is a control.
 *
 * Rebuilt for L06 experiment 3, because as shipped this suite could not measure that. Three
 * defects, each of which alone was enough to invalidate the A/B:
 *
 *  1. The fixtures described `server/src/modules/checkout/**` and `reviewer-core/src/pipeline/run.ts`
 *     — NO file referenced by any of the three diffs exists in this repository. `agentTask` hands
 *     the agent its declared tools and runs it from REPO_ROOT, so the agent went looking, found
 *     nothing, and returned "Cannot start" — which its own Step 0 (`is the scope decidable?`)
 *     REQUIRES of it. The agent's most correct behaviour scored 0 on every practice.
 *  2. The practices demanded the identifiers `inward-only-dependencies`, `di-discipline`,
 *     `reviewer-core-zero-io` and `reviewer-core-ground-findings-gate`. None of those exists —
 *     they appear nowhere in the repo except the old copy of this file. The real rules live in
 *     `server/.dependency-cruiser-onion.cjs`. So the citation practice, the ONE practice the whole
 *     A/B rests on, could only pass by hallucinating an invented string, and scored 0% in BOTH
 *     variants. A strict agent citing `no-concrete-adapter-in-app-layer` correctly was graded FAIL.
 *  3. `pnpm eval:delta` keys on the full vitest nodeid, which embeds the eval file path and the
 *     `describe` name — so `agent:architecture-reviewer` and `agent:architecture-reviewer-lite`
 *     rows never match and every delta row renders `—% -> n/a`. The two series have to be compared
 *     by case name instead.
 *
 * The fixtures now touch REAL files and plant violations that map onto REAL rule names:
 *   onion-service.diff  fastify into a service        -> `no-fastify-below-delivery`
 *                       concrete adapter in a service -> `no-concrete-adapter-in-app-layer`
 *                       db/schema into helpers.ts     -> `db-schema-only-in-data-layer`
 *   core-gate.diff      `node:fs` in reviewer-core    -> `core-stays-pure`
 *                       groundFindings() gate removed -> invariant 1, "Grounding is mandatory"
 *                       (`docs/architecture.md` § The five invariants — an invariant, not a
 *                       dependency-cruiser rule, which is exactly the distinction the strict
 *                       variant's "state the rule by name" paragraph asks the agent to make)
 *   benign-rename.diff  a local-variable rename       -> nothing; the correct answer is silence
 */

// The agent's Step 0 refuses a scope that does not resolve to files that exist. That refusal is
// correct behaviour and not what this eval measures, so the scope is established here the way a
// real caller would establish it. Identical for both variants, so the A/B stays controlled — and
// the agent is still free to read the repo for the DOCUMENTED RULES, which is the point.
const SCOPE = `You are reviewing a proposed change that is not yet committed. The diff below IS the
scope — treat it as the authoritative content of those files and do not go looking for the change
in the working tree or in git history; it is not there yet. The paths are real, and the
repository's own rule sources (\`server/.dependency-cruiser-onion.cjs\`, \`docs/architecture.md\`,
the CLAUDE.md files) are on disk for you to consult.

Audit this diff against DevDigest's documented structural contracts.`;

const ONION_PROMPT = `${SCOPE}\n\n${fx("onion-service.diff")}`;
const CORE_PROMPT = `${SCOPE}\n\n${fx("core-gate.diff")}`;
const BENIGN_PROMPT = `${SCOPE}\n\n${fx("benign-rename.diff")}`;

export const cases: AgentCase[] = [
  {
    name: "flags the three server-side violations and names the rule that each one breaks",
    kind: "quality",
    prompt: ONION_PROMPT,
    practices: [
      "flags the `import type { FastifyReply } from 'fastify'` added to modules/reviews/service.ts as a violation — HTTP must not reach a service",
      "flags the `new OctokitGitHubClient(...)` / the import of `../../adapters/github/octokit.js` inside modules/reviews/service.ts as a violation — a service must take the port off the container instead of constructing a concrete adapter",
      "flags the `import { reviews, findings } from '../../db/schema.js'` added to modules/reviews/helpers.ts as a violation — db/schema belongs to the data layer",
      "citation: names at least two of the real dependency-cruiser rule identifiers `no-fastify-below-delivery`, `no-concrete-adapter-in-app-layer`, `db-schema-only-in-data-layer` rather than describing the problems only in prose",
      "assigns a severity (critical/high/medium/low/info) to each finding",
      "gives a `file:line` for each finding rather than naming the file alone",
    ],
    threshold: 0.6,
    maxTurns: 25,
  },
  {
    name: "flags the reviewer-core purity break and the removed grounding gate",
    kind: "quality",
    prompt: CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/review/run.ts as a violation — reviewer-core does no I/O",
      "flags that the `groundFindings(...)` call was deleted, so findings are now emitted without passing the citation-grounding gate",
      "citation: names the real rule identifier `core-stays-pure` for the node:fs finding rather than describing it only in prose",
      "citation: attributes the removed gate to DevDigest's documented grounding invariant (invariant 1 / 'Grounding is mandatory' in docs/architecture.md) rather than describing it only in prose",
      "gives a `file:line` for each finding rather than naming the file alone",
    ],
    threshold: 0.6,
    maxTurns: 25,
  },
  {
    name: "negative — does not invent a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no violations for the benign local-variable rename, or records only info-level non-blocking observations — it does not invent a critical/high/medium finding",
      "does not attribute a documented rule identifier to this diff, since it breaks none",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
