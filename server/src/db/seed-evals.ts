/**
 * The eval demo's data: the six findings the seed ADDS to the demo review, the
 * decision every one of the ten carries, and which eight of them become cases.
 *
 * Why this is data and not code. The seed's job is idempotence — three blocks,
 * each guarded on its own absence — and that logic is hard to read with a
 * hundred lines of fixture in the middle of it. Keeping the fixture here also
 * makes the two invariants below checkable by eye:
 *
 *  1. **Every finding sits inside a real hunk of `PR_482_FILES`.** An expectation
 *     citing a file or a line the frozen diff does not contain can never be
 *     matched, so `recall` would be structurally 0 and the demo would show a
 *     broken agent rather than a working pipeline. The `hunk` note on each entry
 *     records the range it was checked against.
 *  2. **Nothing sits on `src/middleware/ratelimit.ts:28`.** That line already
 *     carries the seeded SUGGESTION, and `e2e/specs/09-pr-smart-diff.flow.json`
 *     clicks its per-line control BY NAME ("Open the suggestion on line 28…").
 *     A second finding on that line makes the locator mean "whichever the runner
 *     picks first" (`e2e/INSIGHTS.md`, 2026-08-23).
 *  3. **Nothing sits on `src/server.ts` at all.** Same rule as (2), one level up:
 *     `test/smart-diff.it.test.ts` uses that file as the NEGATIVE control for
 *     "an older review does not leak its findings" — it plants a finding on
 *     `src/server.ts:22` in a superseded review and asserts the latest review
 *     reports none there. A seeded finding on that file would not fail the
 *     assertion so much as empty it of meaning, and the fix belongs here rather
 *     than in the lane that is doing its job. The double-mount finding this file
 *     would naturally hang on `src/server.ts:22` is recorded against the router
 *     side of the same defect instead, which is just as true.
 *
 * RENAME CAVEAT (root `INSIGHTS.md`, 2026-08-06): these rows are keyed by
 * `(review_id, file, start_line, title)`. The seed is insert-only, so RENAMING a
 * title here leaves the old row behind on an already-seeded database — the new
 * one appears beside it and the finding count goes up rather than staying put.
 * Changing a title is a manual cleanup, not a re-seed.
 */

/** A finding the seed adds to the demo review, with the decision it carries. */
export interface SeedFinding {
  file: string;
  startLine: number;
  endLine: number;
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  category: 'bug' | 'security' | 'perf' | 'style' | 'test';
  title: string;
  rationale: string;
  suggestion: string;
  confidence: number;
  /** The `PR_482_FILES` hunk this range was checked against — invariant 1 above. */
  hunk: string;
}

/**
 * Six findings added to the demo review, on top of the four it already carries.
 *
 * Ten, not eight, because eight decided findings that ALL become cases leave no
 * un-cased fixture for "create a case from a decided finding" and "do not create
 * a second one" to use. Two of the ten are deliberately left out of the case set
 * below — one accepted, one dismissed.
 */
export const SEED_EVAL_FINDINGS: SeedFinding[] = [
  {
    file: 'src/middleware/ratelimit.ts',
    startLine: 19,
    endLine: 22,
    severity: 'WARNING',
    category: 'security',
    title: 'Anonymous callers are bucketed by a spoofable client IP',
    rationale:
      '`bucketKey` falls back to `req.ip` for unauthenticated callers. With a proxy in front, that value comes from a header the caller controls, so rotating it resets the bucket on every request.',
    suggestion:
      'Derive the anonymous bucket from the socket address, or pin the number of trusted proxy hops instead of trusting the whole chain.',
    confidence: 0.88,
    hunk: 'src/middleware/ratelimit.ts @@ +1,84 — new lines 1-84',
  },
  {
    file: 'src/api/public/index.ts',
    startLine: 15,
    endLine: 17,
    severity: 'WARNING',
    category: 'bug',
    title: 'The health probe is mounted below the limiter it claims to be exempt from',
    rationale:
      'The comment says the health route is unlimited on purpose, but `publicRouter.use(rateLimit)` is registered above it, so the probe is throttled with everything else — and a health check that reports an outage of its own making is worse than none.',
    suggestion: 'Register `/health` on the router before the limiter, or on a router that has none.',
    confidence: 0.93,
    hunk: 'src/api/public/index.ts @@ +1,24 — new lines 1-19 (the health route is 15-17)',
  },
  {
    file: 'src/api/public/index.ts',
    startLine: 8,
    endLine: 10,
    severity: 'WARNING',
    category: 'bug',
    title: 'The limiter runs twice on /api/public, so every request costs two buckets',
    rationale:
      "`publicRouter.use(rateLimit)` here and `app.use('/api/public', rateLimit)` in `src/server.ts` both fire for the same request. Each one increments the bucket, so the effective limit is half the configured one.",
    suggestion: 'Keep this registration and drop the app-level one.',
    confidence: 0.9,
    hunk: 'src/api/public/index.ts @@ +1,24 — new lines 1-19 (the mount is 8-10)',
  },
  {
    file: 'src/config.ts',
    startLine: 16,
    endLine: 16,
    severity: 'CRITICAL',
    category: 'security',
    title: 'trustProxy: true turns the IP bucket into an opt-out',
    rationale:
      'With `trustProxy` on, `req.ip` is read from `X-Forwarded-For`. Any unauthenticated caller can send a fresh value per request and never hit the anonymous limit this pull request adds.',
    suggestion:
      'Set the trusted-proxy count to the number of hops actually in front of the app rather than trusting the whole header.',
    confidence: 0.95,
    hunk: 'src/config.ts @@ +10,8 — new lines 10-17 (trustProxy is 16)',
  },
  {
    file: 'test/ratelimit.test.ts',
    startLine: 16,
    endLine: 20,
    severity: 'SUGGESTION',
    category: 'test',
    title: 'The 429 case spends a real bucket ANON_LIMIT times',
    rationale:
      'The loop issues 60 calls against shared state to reach one assertion, and it leaves the bucket reset to whoever runs next.',
    suggestion: 'Set the counter directly and assert on the 61st call.',
    confidence: 0.58,
    hunk: 'test/ratelimit.test.ts @@ +12,12 — new lines 12-23',
  },
  {
    file: 'package.json',
    startLine: 17,
    endLine: 19,
    severity: 'SUGGESTION',
    category: 'style',
    title: 'Unrelated dependency bumps ride along with the feature',
    rationale:
      '`ioredis` moves a minor version and `ms` and `zod` are added in the same change as the limiter, which makes a bisect over this pull request ambiguous.',
    suggestion: 'Split the dependency changes into their own pull request.',
    confidence: 0.55,
    hunk: 'package.json @@ +14,9 — new lines 14-22',
  },
];

/**
 * The decision each of the ten findings carries, keyed by `file:startLine`.
 *
 * Six accepted and four dismissed, so the demo set exercises both expectation
 * kinds: an accepted finding becomes `must_find`, a dismissed one becomes
 * `must_not_flag`.
 */
export const SEED_FINDING_DECISIONS: Record<string, 'accepted' | 'dismissed'> = {
  // the four the demo review already carried
  'src/config.ts:12': 'accepted',
  'src/api/public/webhooks.ts:61': 'accepted',
  'src/api/users.ts:45': 'dismissed',
  'src/middleware/ratelimit.ts:28': 'dismissed',
  // the six added above
  'src/middleware/ratelimit.ts:19': 'accepted',
  'src/api/public/index.ts:15': 'accepted',
  'src/api/public/index.ts:8': 'accepted',
  'src/config.ts:16': 'accepted',
  'test/ratelimit.test.ts:16': 'dismissed',
  'package.json:17': 'dismissed',
};

/**
 * The eight of the ten that become eval cases, keyed the same way.
 *
 * The two left out are `src/config.ts:16` (accepted) and `package.json:17`
 * (dismissed) — the fixtures the integration lane needs for "create a case from
 * an accepted finding", "create one from a dismissed finding" and "do not create
 * a second". One of each kind, so both branches have a clean starting point.
 */
export const SEED_EVAL_CASE_KEYS: string[] = [
  'src/config.ts:12',
  'src/api/public/webhooks.ts:61',
  'src/api/users.ts:45',
  'src/middleware/ratelimit.ts:28',
  'src/middleware/ratelimit.ts:19',
  'src/api/public/index.ts:15',
  'src/api/public/index.ts:8',
  'test/ratelimit.test.ts:16',
];

/** The key both maps above use: a finding is identified by where it points. */
export const findingKey = (file: string, startLine: number): string => `${file}:${startLine}`;
