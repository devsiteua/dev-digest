import type { Finding } from '@devdigest/shared';

/**
 * The scope gate — findings the reviewer itself judged to be beside the change.
 *
 * The brief asks for two things at once: comments outside the pull request's
 * scope are filtered out, AND a serious problem outside its bounds still keeps
 * one signal. Both halves matter. A review that reports every latent issue in
 * every file it happened to read is a review nobody finishes; a review that can
 * be talked into silence about a critical defect is worse than none.
 *
 * Four properties make this safe to run on every review, each one testable:
 *
 *   1. It acts on `Finding.scope`, which the REVIEWING MODEL sets. The author's
 *      `out_of_scope` list is information in the prompt and suppresses nothing —
 *      if a PR body could descope its own review, `INJECTION_GUARD` would be a
 *      comment rather than a defence.
 *   2. Unlabelled is `in`. A model that ignores the field, an older run, a
 *      provider that dropped it from the structured reply — all produce exactly
 *      the finding set they produced before this file existed.
 *   3. It is inert unless the caller activates it — a review whose prompt
 *      carried no derived intent keeps exactly the finding set it produced
 *      before this file existed, because the caller passes `active: false`.
 *   4. It never removes every CRITICAL. Of the out-of-scope CRITICALs the single
 *      most confident one survives, which is the brief's "one signal".
 *
 * Nothing here is silent: every drop is returned with a reason, and the caller
 * writes each one to the run log. A filter the user cannot see is the one thing
 * this repository's review path has never had.
 */

export interface ScopeGateResult {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
}

/**
 * Apply the gate to a grounded finding set.
 *
 * Order is preserved for the survivors: the kept findings come back in the order
 * they arrived, so a caller diffing against the pre-gate list sees deletions and
 * never a reshuffle.
 */
export function applyScopeGate(
  findings: Finding[],
  opts: { active?: boolean } = {},
): ScopeGateResult {
  // Inert unless the CALLER says the prompt carried a derived intent.
  //
  // This used to be implied — "the model is only asked for the label when the
  // prompt has an intent" — and that was false. `Finding.scope` is part of the
  // `Review` schema, so its description travels in the JSON Schema of EVERY
  // structured call, strict mode marks it required-but-nullable, and a model
  // will happily label `out` on a run whose prompt never mentioned an intent.
  // Dropping those findings would make an intent-less review quieter than the
  // identical pre-L03 one, which is a behaviour change nobody asked for.
  if (opts.active === false) {
    return { kept: findings, dropped: [] };
  }

  const outCriticals = findings.filter((f) => f.scope === 'out' && f.severity === 'CRITICAL');

  // The signal: the most confident out-of-scope CRITICAL. Ties go to the first,
  // which is the order the model reported them in — a stable choice, so two runs
  // over the same reply keep the same finding.
  let signal: Finding | undefined;
  for (const f of outCriticals) {
    if (!signal || f.confidence > signal.confidence) signal = f;
  }

  const kept: Finding[] = [];
  const dropped: { finding: Finding; reason: string }[] = [];

  for (const finding of findings) {
    if (finding.scope !== 'out') {
      kept.push(finding);
      continue;
    }
    if (finding === signal) {
      kept.push(finding);
      continue;
    }
    dropped.push({
      finding,
      reason:
        finding.severity === 'CRITICAL'
          ? `out of scope, and a more confident out-of-scope CRITICAL is already the signal`
          : `out of scope for this pull request (${finding.severity})`,
    });
  }

  return { kept, dropped };
}

/** Human-readable summary for the run trace's stats, beside `grounding`. */
export function scopeGateSummary(result: ScopeGateResult): string {
  const total = result.kept.length + result.dropped.length;
  const signal = result.kept.some((f) => f.scope === 'out');
  return (
    `${result.kept.length}/${total} in scope` +
    (signal ? '; 1 out-of-scope CRITICAL kept as the signal' : '')
  );
}
