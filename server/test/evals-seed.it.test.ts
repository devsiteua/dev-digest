/**
 * The eval demo data, and the only property that matters about a seed: running
 * it twice leaves the same database as running it once.
 *
 * AC-09 names THREE populations, not one, so this lane counts three counters on
 * both sides of a second `seed()` — decided findings, eval cases, and the demo
 * review's owner. Each of the three is written by a different guard, and a guard
 * that converges for one is no evidence about the other two: the findings block
 * is keyed on (file, start_line, title), the case block on the OWNER having no
 * cases at all, and the backfill on `agent_id is null`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { EvalExpectation } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('seed: the eval demo set', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const demoReview = async () => {
    const { db } = pg.handle;
    const [review] = await db.select().from(t.reviews).where(eq(t.reviews.model, 'seed'));
    return review!;
  };

  const counts = async () => {
    const { db } = pg.handle;
    const review = await demoReview();
    const decided = await db
      .select({ id: t.findings.id })
      .from(t.findings)
      .where(
        and(
          eq(t.findings.reviewId, review.id),
          or(isNotNull(t.findings.acceptedAt), isNotNull(t.findings.dismissedAt)),
        ),
      );
    const all = await db
      .select({ id: t.findings.id })
      .from(t.findings)
      .where(eq(t.findings.reviewId, review.id));
    const cases = await db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(eq(t.evalCases.ownerId, review.agentId!));
    return { decided: decided.length, findings: all.length, cases: cases.length };
  };

  it('AC-01: the seeded agent owns at least eight eval cases', async () => {
    const c = await counts();
    expect(c.cases).toBeGreaterThanOrEqual(8);
  });

  it('AC-09: at least eight findings on the demo review carry a decision', async () => {
    const c = await counts();
    expect(c.decided).toBeGreaterThanOrEqual(8);
    // and every finding is decided — an undecided one would be a gap in the map
    expect(c.decided).toBe(c.findings);
  });

  it('AC-09: the demo review names an agent, so a case has an owner', async () => {
    const review = await demoReview();
    expect(review.agentId).not.toBeNull();
  });

  it('leaves one accepted and one dismissed finding WITHOUT a case, as fixtures', async () => {
    const { db } = pg.handle;
    const review = await demoReview();
    const findings = await db
      .select()
      .from(t.findings)
      .where(eq(t.findings.reviewId, review.id));
    const cases = await db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.ownerId, review.agentId!));
    const cased = new Set(
      cases.map((c) => (c.inputMeta as { source_finding_id: string }).source_finding_id),
    );
    const uncased = findings.filter((f) => !cased.has(f.id));

    expect(uncased.filter((f) => f.acceptedAt !== null)).toHaveLength(1);
    expect(uncased.filter((f) => f.dismissedAt !== null)).toHaveLength(1);
  });

  it('every seeded expectation parses under EvalExpectation', async () => {
    const { db } = pg.handle;
    const cases = await db.select().from(t.evalCases);
    expect(cases.length).toBeGreaterThanOrEqual(8);
    for (const c of cases) {
      const parsed = EvalExpectation.safeParse(c.expectedOutput);
      expect(parsed.success, `case ${c.name}: ${JSON.stringify(c.expectedOutput)}`).toBe(true);
    }
  });

  it('every seeded case carries its provenance and a non-empty frozen diff', async () => {
    const { db } = pg.handle;
    const cases = await db.select().from(t.evalCases);
    for (const c of cases) {
      expect(c.ownerKind).toBe('agent');
      expect(c.inputDiff?.length ?? 0).toBeGreaterThan(0);
      const meta = c.inputMeta as { source_finding_id: string; created_from: string };
      expect(meta.created_from).toBe('finding');
      expect(meta.source_finding_id).toBeTruthy();
    }
  });

  it('AC-09: a second seed doubles none of the three populations', async () => {
    const before = await counts();
    await seed(pg.handle.db);
    const after = await counts();
    expect(after).toEqual(before);

    const review = await demoReview();
    expect(review.agentId).not.toBeNull();

    // and no review anywhere was left without an owner by the backfill re-running
    const ownerless = await pg.handle.db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(and(eq(t.reviews.model, 'seed'), isNull(t.reviews.agentId)));
    expect(ownerless).toHaveLength(0);
  });
});
