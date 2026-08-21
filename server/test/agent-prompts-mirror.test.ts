import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from '../src/db/seed-prompts.js';

/**
 * `server/CLAUDE.md` says an agent prompt lives in TWO hand-synced places:
 * `docs/agent-prompts/<name>.md` (the reviewable original) and
 * `src/db/seed-prompts.ts` (what a fresh workspace gets). "Synced by hand" is
 * exactly the kind of rule that rots silently, so this test is the sync.
 */
const docs = fileURLToPath(new URL('../../docs/agent-prompts/', import.meta.url));
const read = (f: string) => readFileSync(docs + f, 'utf8').trimEnd();

describe('seed prompts mirror docs/agent-prompts', () => {
  it.each([
    ['general-reviewer.md', GENERAL_REVIEWER_PROMPT],
    ['security-reviewer.md', SECURITY_REVIEWER_PROMPT],
    ['performance-reviewer.md', PERFORMANCE_REVIEWER_PROMPT],
    ['test-quality-reviewer.md', TEST_QUALITY_REVIEWER_PROMPT],
    ['api-contract-reviewer.md', API_CONTRACT_REVIEWER_PROMPT],
  ])('%s is byte-identical to its seeded constant', (file, constant) => {
    expect(constant).toBe(read(file));
  });
});
