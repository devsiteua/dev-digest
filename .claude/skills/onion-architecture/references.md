# References

Sources behind the rules in `SKILL.md`, with what each one is good for. All links checked
2026-08-05.

## The canon

- [The Onion Architecture, part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/)
  — Jeffrey Palermo, 2008. The origin: all coupling points toward the centre, the database is
  external, infrastructure is pushed out behind interfaces.
- [part 2](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/) ·
  [part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/) — the layers in
  detail and how the composition root wires them.
- [part 4 — after four years](https://jeffreypalermo.com/2013/08/onion-architecture-part-4-after-four-years/)
  — the author's own retrospective; read it before adding ceremony.
- [Onion Architecture — Herberto Graça](https://herbertograca.com/2017/09/21/onion-architecture/)
  — where onion sits relative to ports-and-adapters and clean architecture. Useful when someone
  argues the three are different things.
- [Onion Architecture — Allegro Tech](https://blog.allegro.tech/2023/02/onion-architecture.html)
  — a production team's account, including where the pattern cost them.
- [Anemic domain model](https://en.wikipedia.org/wiki/Anemic_domain_model) — the failure mode a
  formally layered codebase drifts into. The reason `SKILL.md` ends with "keep it proportional".

## TypeScript / Node practice

- [Clean Node.js Architecture — Khalil Stemmler](https://khalilstemmler.com/articles/enterprise-typescript-nodejs/clean-nodejs-architecture/)
  — layering in TS without a DI framework; closest to how `Container` works here.
- [Ports and Adapters explained with two real codebases](https://saadh393.github.io/blog/adapter-port-architecture-two-cases)
  — the one-line version of our rule: business logic imports ports, never adapters.
- [Atomic Repositories in Clean Architecture and TypeScript — Sentry](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/)
  — repository boundaries, transaction handling, and error translation without leaking the ORM.

## Our tools

- [Fastify — Plugins](https://fastify.dev/docs/latest/Reference/Plugins/) and
  [the plugins guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/) — encapsulation and
  the `register` scope, which is what makes a module plugin an architectural boundary.
- [Fastify plugins as building blocks — Snyk](https://snyk.io/blog/fastify-plugins-for-backend-node-js-api/)
  — the same idea applied to structuring a backend.
- [Drizzle ORM best practices](https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/)
  — why a repository must not return query builders and should translate database errors.
- [Zod](https://zod.dev/) — schema-first validation at the edge; our contracts double as
  serialization schemas.

## Enforcement

- [dependency-cruiser rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
  — the syntax used in `server/.dependency-cruiser-onion.cjs`, including `--ignore-known`
  baselines. Note: npm modules resolve as `node_modules/<pkg>/…`, so a `to.path` of
  `^drizzle-orm` matches nothing.
- [Restricting imports with dependency-cruiser — Atomic Object](https://spin.atomicobject.com/dependency-cruiser-imports/)
  — a short worked example of forbidding a direction of import.
- [How we enforce architecture boundaries at scale — lastminute.com](https://technology.lastminute.com/how-we-enforce-architecture-boundaries-at-scale-on-our-app/)
  — introducing a guard into a codebase that already has violations, which is exactly our case.
