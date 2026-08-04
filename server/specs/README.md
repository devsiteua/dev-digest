# Server specs

Specs for work confined to `@devdigest/api`. Anything touching another package — which most
lessons do — belongs in the root [`../../specs/`](../../specs/README.md).

Format, status values, and the promotion rules are defined once in the root specs README.
Copy [`../../specs/TEMPLATE.md`](../../specs/TEMPLATE.md).

Server-specific sections worth filling in every time:

- **Migrations** — does this need `pnpm db:generate`? Which tables?
- **Contracts** — does this change `vendor/shared`? Then it needs the mirror edit in
  `client/src/vendor/shared`.
- **Test lane** — hermetic unit, or a `*.it.test.ts` against real Postgres, or both?

No open server-only specs.
