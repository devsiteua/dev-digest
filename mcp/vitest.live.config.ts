import { defineConfig } from 'vitest/config';

/**
 * The live lane — the tests that need a running DevDigest API on :3001.
 *
 * A second config rather than a flag on the first, because the two lanes select
 * opposite sets: `vitest.config.ts` EXCLUDES `**\/*.live.test.ts` so `pnpm test`
 * stays hermetic and offline, and this one includes nothing else. Neither lane
 * can accidentally run the other's files, and `pnpm test` keeps working with no
 * stack, no network and no Docker.
 *
 * Why a `*.live.test.ts` suffix instead of the repo's `*.it.test.ts`: root
 * `CLAUDE.md` ties `*.it.test.ts` to "a test that touches the DB", and CI splits
 * the `server/` lanes on exactly that glob. These tests touch an HTTP API, not a
 * database, and no workflow selects `mcp/**` at all — reusing the suffix would
 * make the repo's one crisp naming rule mean two things.
 *
 * The `@devdigest/shared` alias is absent here for the same reason it is absent
 * from `vitest.config.ts`: contracts are type-only imports (D2), and a value
 * import must fail loudly rather than pull the server's Zod 3 into this Zod 4
 * package.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.live.test.ts'],
    exclude: ['**/node_modules/**'],
    // Every assertion here crosses a real HTTP boundary, and one of them polls a
    // run. The hermetic lane's 5 s default would be flaky rather than fast.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
