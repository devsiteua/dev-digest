import { defineConfig } from 'vitest/config';

/**
 * Mirrors `reviewer-core/vitest.config.ts` minus its `@devdigest/shared` alias.
 *
 * The alias is deliberately absent HERE while present in `tsconfig.json`, and the
 * asymmetry is the point. Every contract import in this package is `import type`
 * (D2), so TypeScript erases it and nothing resolves `@devdigest/shared` at
 * runtime. Declaring the alias for vitest too would quietly make a *value* import
 * of a server contract work — pulling the server's Zod 3 module into a package
 * that runs Zod 4, which `server/CLAUDE.md` records as the thing that makes
 * `instanceof z.ZodError` unreliable. Without it, such an import fails loudly at
 * the first test instead.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // The live lane needs a running API on :3001 and is driven by its own
    // command; the default lane stays hermetic.
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
  },
});
