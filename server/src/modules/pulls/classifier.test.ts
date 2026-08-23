/**
 * `classifyFile` — the rule that decides where a changed file lands in the
 * Smart Diff: `core`, `wiring` or `boilerplate`.
 *
 * WHY THIS FILE LIVES HERE. The L03 checklist names this exact path and runs it
 * through `pnpm verify:l03`. The function itself belongs to the module that owns
 * classification (`modules/smart-diff/`), and it stays there: a re-export under
 * `modules/pulls/` would be a `pulls → smart-diff` edge, which the onion guard
 * reports as `no-cross-module-import`. Test files are excluded from that cruise
 * (`.dependency-cruiser-onion.cjs`, `options.exclude`), so the mandated path
 * costs the architecture nothing.
 *
 * The risk here is not a crash — it is a file quietly landing in the wrong group,
 * which looks like a working feature and reads like a reviewer's mistake. So the
 * classifier is tested as a TABLE: one row per rule, plus the cases where two
 * rules could both fire and the first-match ladder has to decide.
 */
import { describe, it, expect } from 'vitest';
import { classifyFile } from '../smart-diff/helpers.js';

describe('classifyFile', () => {
  it.each([
    ['business logic under src/', 'src/middleware/ratelimit.ts', 'core'],
    ['an API handler', 'src/api/users.ts', 'core'],
    ['a file no rule recognises', 'weird-thing', 'core'],
    ['a deep unknown path', 'packages/pay/domain/ledger.rs', 'core'],
    ['a barrel', 'src/api/public/index.ts', 'wiring'],
    ['an entry point', 'src/server.ts', 'wiring'],
    ['a config module', 'src/config.ts', 'wiring'],
    ['a tool config', 'vitest.config.mts', 'wiring'],
    ['a manifest', 'package.json', 'wiring'],
    ['a tsconfig', 'client/tsconfig.json', 'wiring'],
    ['a container image', 'Dockerfile', 'wiring'],
    ['a CI definition', '.github/workflows/server-unit.yml', 'wiring'],
    ['an env template', '.env.example', 'wiring'],
    ['a lock file', 'package-lock.json', 'boilerplate'],
    ['build output', 'dist/index.js', 'boilerplate'],
    ['a snapshot', 'src/__snapshots__/card.snap', 'boilerplate'],
    ['a minified bundle', 'public/app.min.js', 'boilerplate'],
    ['a declaration file', 'types/global.d.ts', 'boilerplate'],
    ['a generated migration', 'server/src/db/migrations/0011_violet.sql', 'boilerplate'],
    ['a unit test', 'src/lib/rate.test.ts', 'boilerplate'],
    ['a test directory', 'test/ratelimit.ts', 'boilerplate'],
    ['documentation', 'docs/architecture.md', 'boilerplate'],
    ['a root readme', 'README.md', 'boilerplate'],
  ] as const)('classifies %s → %s', (_what, path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  // The ladder's whole purpose: the pairs where two rules could fire.
  it('puts a lock file in boilerplate wherever it lives, and its manifest in wiring', () => {
    expect(classifyFile('services/payments/package-lock.json')).toBe('boilerplate');
    expect(classifyFile('services/payments/package.json')).toBe('wiring');
  });

  it('is case-insensitive, so a capitalised lock file is still a lock file', () => {
    expect(classifyFile('Cargo.lock')).toBe('boilerplate');
    expect(classifyFile('Gemfile.lock')).toBe('boilerplate');
    expect(classifyFile('Makefile')).toBe('wiring');
  });

  it('prefers boilerplate over wiring when both match', () => {
    // `index.*` is wiring, `.d.ts` and `dist/` are boilerplate — boilerplate runs first.
    expect(classifyFile('dist/index.js')).toBe('boilerplate');
    expect(classifyFile('src/index.d.ts')).toBe('boilerplate');
    expect(classifyFile('test/config.ts')).toBe('boilerplate');
  });

  it('matches directory rules on whole segments, never as substrings', () => {
    expect(classifyFile('src/vendor-audit/report.ts')).toBe('core');
    expect(classifyFile('src/layout/header.ts')).toBe('core');
    expect(classifyFile('src/testing-lib/render.ts')).toBe('core');
    expect(classifyFile('src/vendor/shared/contracts.ts')).toBe('boilerplate');
  });

  it('does not read a config-shaped name into a real module', () => {
    expect(classifyFile('src/config-loader.ts')).toBe('core');
    expect(classifyFile('src/indexer.ts')).toBe('core');
  });
});
