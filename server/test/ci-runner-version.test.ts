import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RUNNER_VERSION } from '../src/modules/ci/constants.js';

/**
 * L07-B — the one duplication this feature could not avoid.
 *
 * `GET /agents/:id/ci` answers with `RUNNER_VERSION` (AC-27) and no tsconfig
 * path alias exposes `agent-runner` to `server/`. Adding one would either break
 * the dependency rule or drag a package this stream must not touch into the
 * graph, so the literal is re-declared in `modules/ci/constants.ts` — and a
 * duplication nobody checks is a duplication that drifts.
 *
 * The runner's source is read as TEXT, not imported. That is deliberate and it
 * crosses no boundary `arch:check` polices: `depcruise` cruises `src` only, its
 * own config drops every `*.test.ts`, and a `readFileSync` of a path string is
 * not a dependency edge in the first place — dependency-cruiser follows imports.
 */

const artifactPath = fileURLToPath(new URL('../../agent-runner/src/artifact.ts', import.meta.url));

describe('RUNNER_VERSION is duplicated, not drifted', () => {
  it("matches the literal in agent-runner/src/artifact.ts (AC-27)", () => {
    const source = readFileSync(artifactPath, 'utf8');

    const declaration = /export const RUNNER_VERSION\s*=\s*'([^']*)'/.exec(source);

    // Fail as "the declaration moved" rather than as "undefined !== '1'": a
    // rename in the runner must not make this test silently vacuous.
    expect(declaration, `no RUNNER_VERSION declaration found in ${artifactPath}`).not.toBeNull();
    expect(declaration?.[1]).toBe(RUNNER_VERSION);
  });
});
