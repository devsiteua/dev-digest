/**
 * Onion architecture guard — the dependency rule, made executable.
 *
 * One rule, six checks: imports point INWARD. Delivery (routes) may know the
 * application layer; the application layer may know ports; nothing inward may
 * know Fastify, Drizzle, or a concrete adapter.
 *
 *   pnpm arch:check        # honours the baseline of known violations
 *   pnpm arch:check:all    # every violation, baseline included
 *
 * Known violations are frozen in `.dependency-cruiser-known-violations.json`
 * (regenerate: `pnpm exec depcruise src --config .dependency-cruiser-onion.cjs
 * --output-type baseline > .dependency-cruiser-known-violations.json`). Freeze
 * only what already existed — a NEW violation must fail, never be baselined.
 *
 * Rationale and the ring map: `.claude/skills/onion-architecture/SKILL.md`.
 * Rule syntax: https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
 *
 * Gotcha: npm modules resolve to `node_modules/<pkg>/…`, so a `to.path` of
 * `^drizzle-orm` silently matches NOTHING. Always anchor on `node_modules/`.
 */
module.exports = {
  forbidden: [
    {
      name: 'orm-only-in-data-layer',
      comment:
        'Drizzle and the postgres driver belong to the outermost ring. Query from a ' +
        'repository (or src/db), never from a route, service, or helper.',
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: '(repository|^src/db/|^src/platform/jobs\\.ts$|^src/app\\.ts$|^src/adapters/auth/)',
      },
      to: { dependencyTypes: ['npm'], path: 'node_modules/(drizzle-orm|postgres)/' },
    },
    {
      name: 'db-schema-only-in-data-layer',
      comment:
        'The Drizzle schema is the persistence model. Modules reach it through a ' +
        'repository. `src/db/rows.ts` is the sanctioned exception: shared row types ' +
        'exist so cross-cutting consumers need not import another module data layer.',
      severity: 'error',
      from: { path: '^src/modules/', pathNot: 'repository' },
      to: { path: '^src/db/', pathNot: '^src/db/rows\\.ts$' },
    },
    {
      name: 'no-concrete-adapter-in-app-layer',
      comment:
        'A service depends on a PORT, resolved from Container, never on a concrete ' +
        'adapter — otherwise ContainerOverrides cannot swap it in tests.',
      severity: 'error',
      from: { path: '^src/modules/.+/(service|helpers)\\.ts$' },
      to: { path: '^src/adapters/' },
    },
    {
      name: 'no-fastify-below-delivery',
      comment:
        'HTTP stops at routes.ts. Pass primitives and DTOs inward — never req, reply, ' +
        'or a Fastify type.',
      severity: 'error',
      from: { path: '^src/modules/.+/(service|helpers|repository)' },
      to: { dependencyTypes: ['npm'], path: 'node_modules/fastify' },
    },
    {
      name: 'routes-are-a-leaf',
      comment:
        'Delivery is the outermost ring: only the module registry, app.ts, or the ' +
        "module's own barrel may import a routes.ts. An inward import inverts the onion.",
      severity: 'error',
      from: {
        path: '^src/',
        pathNot: '(^src/modules/index\\.ts$|^src/app\\.ts$|^src/modules/[^/]+/index\\.ts$)',
      },
      to: { path: '^src/modules/.+/routes\\.ts$' },
    },
    {
      name: 'core-stays-pure',
      comment:
        'reviewer-core is the domain centre: zero I/O. Its only side effect is the ' +
        'injected LLMProvider. Node built-ins and infrastructure packages are banned.',
      severity: 'error',
      from: { path: 'reviewer-core/src' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'core-stays-framework-free',
      comment: 'Same rule, npm side: no web framework, ORM, driver, or VCS client in the core.',
      severity: 'error',
      from: { path: 'reviewer-core/src' },
      to: {
        dependencyTypes: ['npm'],
        path: 'node_modules/(fastify|drizzle-orm|postgres|octokit|simple-git|@ast-grep)',
      },
    },
    {
      name: 'no-cross-module-import',
      comment:
        'Warning, not an error: cross-module reuse is brokered by Container (see ' +
        'container.agentsRepo). A direct reach into a sibling module is usually a ' +
        'sign the shared piece belongs in _shared, platform, or the container.',
      severity: 'warn',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/([^/]+)/', pathNot: ['^src/modules/$1/', '^src/modules/_shared/'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Resolves @devdigest/shared and @devdigest/reviewer-core path aliases, which
    // is what lets one cruise of src/ also police reviewer-core's purity.
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    exclude: { path: '\\.test\\.ts$' },
  },
};
